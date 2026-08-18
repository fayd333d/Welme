// Welme formulary engine — reference resolver (dependency-free)
// Resolves a quiz response into a personalized, condition-gated daily sachet.
// Data: ./data/*.json
//   Node    : const { resolve } = require('./engine.js');   // loads ./data/*.json itself
//   Browser : WelmeEngine.init({ingredients,protocols,conditions,substitutions,
//                               viability,age_tuning,engine_config});
//             WelmeEngine.resolve(input)
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    // Node: load ./data/*.json eagerly, preserving the original reference behaviour.
    var fs = require('fs');
    var load = function (f) { return JSON.parse(fs.readFileSync(__dirname + '/data/' + f, 'utf8')); };
    api.init({
      ingredients: load('ingredients.json'),
      protocols: load('protocols.json'),
      conditions: load('conditions.json'),
      substitutions: load('substitutions.json'),
      viability: load('viability.json'),
      age_tuning: load('age_tuning.json'),
      engine_config: load('engine_config.json'),
      ingredient_effects: load('ingredient_effects.json')
    });
    module.exports = api;
  } else {
    root.WelmeEngine = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  var ING, SUBS, VIAB, PROT, COND, AGE, CFG, EFFECTS;

  function init(data) {
    ING = {};
    (data.ingredients || []).forEach(function (i) { ING[i.id] = i; });
    SUBS = data.substitutions;
    VIAB = data.viability;
    PROT = data.protocols;
    COND = data.conditions;
    AGE = data.age_tuning;
    CFG = data.engine_config;
    EFFECTS = data.ingredient_effects || {};
    return api;
  }

  var ageBand = function (a) {
    return a < 55 ? 'under_55' : a < 60 ? '55_59' : a < 70 ? '60_69' : a < 80 ? '70_79' : '80_plus';
  };

  var protoFor = function (g) {
    var keys = Object.keys(PROT);
    for (var i = 0; i < keys.length; i++) {
      var p = PROT[keys[i]];
      if (p.label === g || p.id === g) return p;
    }
    return null;
  };

  // An ingredient tag maps to the goal it serves. Shared by the "already
  // taking" step and by the user-facing subtitle further down.
  var tagGoalId = function (tag) {
    if (tag === 'immune') return null;          // no goal — never display
    if (tag === 'mood') tag = 'stress';         // both map to Stress & mood
    return PROT[tag] ? tag : null;
  };

  function resolve(input) {
    var age = input.age, sex = input.sex || 'female';
    var goals = input.goals || [], conditions = input.conditions || [], taking = input.taking || [];
    var W = CFG.slot_weights;
    var cand = {};                       // id -> {weight, sources, flags, form, dose}
    var add = function (id, w, src) {
      if (!ING[id]) return;
      if (!cand[id]) cand[id] = { id: id, weight: 0, sources: {}, flags: [], form: ING[id].form, dose: ING[id].dose };
      cand[id].weight += w; cand[id].sources[src] = 1;
    };

    // 1) union of selected protocols
    // NOTE: protocols.json `branches` is deliberately NOT wired in. Sub-complaints
    // must not affect the box (ingredients, doses or ordering) — they only drive
    // the advice section. Two users differing only in sub-complaints must get
    // identical plans.
    goals.forEach(function (g) {
      var p = protoFor(g);
      if (!p) return;
      p.core.forEach(function (id) { add(id, W.core, p.id); });
    });

    // 1b) what they already take.
    // If it is on our shelf AND it serves one of the goals they picked, it
    // belongs in the box: the box is their whole protocol, not the gap between
    // their shelf and their protocol. An active already in the plan keeps its
    // protocol weight; one that only serves a selected goal by tag joins at the
    // extended weight. Runs before the condition rules on purpose, so a blocked
    // active is still blocked — safety outranks "I already take it".
    // Anything not on our shelf is never added here; it is flagged for
    // interactions by the quiz instead.
    var selectedGoalIds = {};
    goals.forEach(function (g) { var p = protoFor(g); if (p) selectedGoalIds[p.id] = 1; });
    var servesSelectedGoal = function (id) {
      return (ING[id].tags || []).some(function (t) {
        var gid = tagGoalId(t);
        return gid && selectedGoalIds[gid];
      });
    };
    taking.forEach(function (id) {
      if (!ING[id] || !servesSelectedGoal(id)) return;
      add(id, cand[id] ? 0 : W.extended, 'already taking');
      cand[id].alreadyTaking = true;
    });

    // 2) condition rules
    var notes = [];
    var blockedBy = {};
    var pillCap = CFG.default_pill_cap;
    var applyTargets = function (t) {
      if (t === '*') return ['*'];
      if (typeof t === 'string' && t.indexOf('tag:') === 0) {
        var key = t.slice(4);
        return Object.keys(ING).filter(function (id) {
          var i = ING[id];
          return i[key] || (Array.isArray(i.tags) && i.tags.indexOf(key) !== -1);
        });
      }
      return Array.isArray(t) ? t : [t];
    };

    conditions.forEach(function (cx) {
      var spec = COND[cx]; if (!spec) return;
      spec.rules.forEach(function (r) {
        var targets = applyTargets(r.target);
        targets.forEach(function (tid) {
          if (r.action === 'BLOCK') {
            targets.forEach(function (x) { blockedBy[x] = cx; if (cand[x]) cand[x]._blocked = cx; });
          } else if (r.action === 'ENABLE') {
            add(tid, 0.5, 'enabled:' + cx);
            if (cand[tid]) cand[tid].flags.push('added for ' + cx);
          } else if (r.action === 'CAP_TOTAL') {
            pillCap = Math.min(pillCap, 8); notes.push(cx + ': lower pill ceiling');
          } else if (tid === '*') {
            notes.push(cx + ': ' + r.why);
          } else if (cand[tid]) {
            cand[tid].flags.push(r.action + (r.to ? ' → ' + r.to : '') + ' (' + cx + ')');
            if (r.action === 'REDUCE_DOSE') cand[tid].doseNote = r.to;
            if (r.action === 'PREFER_FORM') cand[tid].formNote = r.to;
            if (r.action === 'TIMING') cand[tid].timingNote = r.to;
          }
        });
      });
    });

    // 2b) substitution: swap a blocked active for an allowed in-list alternative, else shorten.
    // The substitute must not itself be blocked for this same user.
    Object.keys(cand).forEach(function (id) {
      if (!cand[id]._blocked) return;
      var s = (SUBS[id] || {}).sub;
      // The substitute must exist on the current shelf — substitutions.json can
      // name an ingredient that has since been removed. Fall back to shortening.
      if (s && !ING[s]) s = null;
      if (s && !blockedBy[s]) {
        if (!cand[s]) {
          add(s, cand[id].weight || W.core, 'sub:' + id);
          cand[s].flags.push('replaces ' + ING[id].name + ' (blocked by ' + cand[id]._blocked + ')');
          cand[id]._subbed = ING[s].name;
        } else {
          cand[id]._subbed = ING[s].name + ' (already in plan)';
        }
      }
    });

    // 3) age + sex tuning
    var band = AGE.bands.filter(function (b) { return b.range === ageBand(age); })[0]
            || AGE.bands.filter(function (b) { return b.range === '60_69'; })[0];
    pillCap = Math.min(pillCap, band.pill_cap);
    band.emphasize.forEach(function (id) { if (cand[id]) cand[id].weight += 1.5; });
    band.deprioritize.forEach(function (id) {
      if (cand[id]) { cand[id].weight -= 2; cand[id].flags.push('de-emphasized ' + age + '+'); }
    });
    ((AGE.sex[sex] || {}).emphasize || []).forEach(function (id) { if (cand[id]) cand[id].weight += 1; });

    // 4) drop what a condition blocks, rank, cap — guarantee >=2 actives per goal.
    // What the user already takes is NOT dropped here any more (see 1b).
    var removed = [];
    var list = Object.keys(cand).map(function (k) { return cand[k]; }).filter(function (c) {
      if (c._blocked) {
        removed.push({ id: c.id, why: c._subbed
          ? 'blocked by ' + c._blocked + ' → replaced with ' + c._subbed
          : 'blocked by ' + c._blocked + ' → protocol shortened (no in-list substitute)' });
        return false;
      }
      return true;
    });
    list.sort(function (a, b) { return b.weight - a.weight || a.id.localeCompare(b.id); });

    var protectedIds = {};
    goals.forEach(function (g) {
      var p = protoFor(g); if (!p) return;
      list.filter(function (c) { return p.core.indexOf(c.id) !== -1; })
          .slice(0, 2).forEach(function (c) { protectedIds[c.id] = 1; });
    });
    // Two ceilings, whichever binds first:
    //   suppCap  — how many distinct actives may be in the box
    //   pillCap  — PHYSICAL PILLS per day (sum of units_per_day), not ingredient count
    // suppCap is enforced on the spare actives; the >=2-per-goal protected set
    // is never trimmed, because dropping one would break that guarantee. The two
    // hold together as long as 2 x max_goals <= max_supplements (6 <= 9 today,
    // and in practice lower because goals share actives). Raise max_goals past 4
    // and they can conflict — revisit this line if you do.
    var suppCap = CFG.max_supplements || 9;
    var units = function (id) { return ING[id].units_per_day || 1; };
    var keepList = list.filter(function (c) { return protectedIds[c.id]; });
    var spare = list.filter(function (c) { return !protectedIds[c.id]; });
    var pills = keepList.reduce(function (s, c) { return s + units(c.id); }, 0);
    var chosen = keepList.slice();
    spare.forEach(function (c) {
      if (chosen.length >= suppCap) {
        removed.push({ id: c.id, why: 'would exceed the supplements-per-box limit (' + suppCap + ')' });
      } else if (pills + units(c.id) <= pillCap) {
        chosen.push(c); pills += units(c.id);
      } else {
        removed.push({ id: c.id, why: 'would exceed the daily pill limit (' + pillCap + ')' });
      }
    });
    list = chosen.sort(function (a, b) { return b.weight - a.weight || a.id.localeCompare(b.id); });
    var totalPills = list.reduce(function (s, c) { return s + units(c.id); }, 0);

    // 4b) viability: is each selected plan still worth selling?
    var kept = {}; list.forEach(function (c) { kept[c.id] = 1; });
    var verdicts = [];
    goals.forEach(function (g) {
      var p = protoFor(g); if (!p) return;
      var v = VIAB.protocols[p.id]; if (!v) return;
      var failed = v.essential.filter(function (grp) {
        return grp.filter(function (id) { return kept[id]; }).length < (v.min || 1);
      });
      verdicts.push({ plan: p.label, viable: failed.length === 0, why: failed.length ? v.why : '' });
    });
    var deferReasons = conditions.filter(function (c) { return VIAB.defer_conditions[c]; })
      .map(function (c) { return { condition: c, why: VIAB.defer_conditions[c] }; });
    var viablePlans = verdicts.filter(function (v) { return v.viable; }).map(function (v) { return v.plan; });
    var deadPlans = verdicts.filter(function (v) { return !v.viable; });
    var status = 'sell', action = '';
    if (deferReasons.length) {
      status = 'pause';
      action = 'Do not sell. ' + deferReasons.map(function (d) { return d.why; }).join(' ') + ' Offer to pause and check back.';
    } else if (deadPlans.length && !viablePlans.length) {
      status = 'pause';
      action = 'Do not sell: ' + deadPlans.map(function (d) { return d.plan; }).join(', ')
             + ' lost the ingredients that make ' + (deadPlans.length > 1 ? 'them' : 'it') + ' work. '
             + deadPlans[0].why + ' Offer to pause.';
    } else if (deadPlans.length) {
      status = 'switch';
      action = "Don't sell " + deadPlans.map(function (d) { return d.plan; }).join(', ')
             + ' — offer ' + viablePlans.join(' / ') + ' instead. ' + deadPlans[0].why;
    }

    // 5) one daily sachet (ranked; taken with a meal)
    // The user-facing subtitle is the intersection of the ingredient's tags with
    // the goals THIS user selected, in their goal order. substitutions.json →
    // role is engine-internal and is deliberately never emitted here.
    var selectedLabels = goals.map(function (g) {
      var p = protoFor(g); return p ? p.label : null;
    }).filter(Boolean);
    var tagLabel = function (tag) {
      var gid = tagGoalId(tag);
      return gid ? PROT[gid].label : null;
    };
    var labelToGoalId = {};
    Object.keys(PROT).forEach(function (k) { labelToGoalId[PROT[k].label] = PROT[k].id; });

    var sachet = list.map(function (c) {
      var matches = [];
      (ING[c.id].tags || []).forEach(function (t) {
        var lab = tagLabel(t);
        if (lab && selectedLabels.indexOf(lab) !== -1 && matches.indexOf(lab) === -1) matches.push(lab);
      });
      matches.sort(function (a, b) { return selectedLabels.indexOf(a) - selectedLabels.indexOf(b); });
      // Effect copy for those same goals, in the same order — personalised, and
      // never describing a goal this user didn't pick.
      var effects = matches.map(function (lab) {
        var gid = labelToGoalId[lab];
        return (EFFECTS[c.id] || {})[gid] || '';
      }).filter(Boolean);
      return {
        id: c.id,
        name: ING[c.id].name,
        dose: ING[c.id].dose,
        displayDose: ING[c.id].dose,     // never show a dose that isn't in ingredients.json
        doseNote: c.doseNote || '',
        formNote: c.formNote || '',
        timingNote: c.timingNote || '',
        form: ING[c.id].form,
        withFood: !!ING[c.id].take_with_food,
        units: ING[c.id].units_per_day || 1,
        goalMatches: matches,            // user-facing subtitle source
        effects: effects,                // personalised "what it does for you" copy
        alreadyTaking: !!c.alreadyTaking, // they told us they already take this
        flags: c.flags
      };
    });
    return {
      status: status, action: action, verdicts: verdicts,
      count: list.length, pills: totalPills, pillCap: pillCap, suppCap: suppCap, band: band.range,
      sachet: sachet, removed: removed,
      notes: notes.filter(function (n, i) { return notes.indexOf(n) === i; }),
      deferReasons: deferReasons, viablePlans: viablePlans,
      deadPlans: deadPlans.map(function (d) { return d.plan; })
    };
  }

  var api = { init: init, resolve: resolve, ageBand: ageBand };
  return api;
}));
