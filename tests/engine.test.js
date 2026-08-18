// Welme formulary engine — acceptance tests.
//   Node    : node tests/engine.test.js
//   Browser : load engine.js + data, then WelmeEngineTests.run(WelmeEngine, data)
'use strict';

function buildSuite(engine, DATA) {
  var results = [];
  var ING = {}; DATA.ingredients.forEach(function (i) { ING[i.id] = i; });
  var CFG = DATA.engine_config, AGE = DATA.age_tuning, PROT = DATA.protocols;

  function t(name, fn) {
    try { fn(); results.push({ name: name, pass: true }); }
    catch (e) { results.push({ name: name, pass: false, err: e.message }); }
  }
  function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  var ids = function (r) { return r.sachet.map(function (s) { return s.id; }); };
  var has = function (r, id) { return ids(r).indexOf(id) !== -1; };

  var BASE = { age: 67, sex: 'female', conditions: [], taking: [] };
  var mk = function (o) {
    var i = {}; Object.keys(BASE).forEach(function (k) { i[k] = BASE[k]; });
    Object.keys(o).forEach(function (k) { i[k] = o[k]; });
    return i;
  };

  // 1 — an active they already take belongs in the box when it is on our shelf
  // and serves a goal they picked. One that serves none of their goals does not.
  t('1. What they already take is kept in the box when it serves a selected goal', function () {
    var r = engine.resolve(mk({
      goals: ['Sleep quality', 'Heart health', 'Longevity'],
      taking: ['mag_glycinate', 'omega3', 'vit_d3']
    }));
    ok(has(r, 'mag_glycinate'), 'magnesium dropped though they take it and it serves sleep');
    ok(has(r, 'omega3'), 'omega-3 dropped though they take it and it serves heart');
    ok(has(r, 'vit_d3'), 'vitamin D3 dropped though they take it and it serves longevity');
    r.sachet.forEach(function (s) {
      if (['mag_glycinate', 'omega3', 'vit_d3'].indexOf(s.id) !== -1) {
        ok(s.alreadyTaking === true, s.id + ' was not marked as already taken');
      }
    });

    // serves none of the selected goals → not pulled into the box
    var r2 = engine.resolve(mk({
      goals: ['Sleep quality'],
      taking: ['citicoline', 'collagen_uc2', 'probiotic']
    }));
    ok(!has(r2, 'citicoline'), 'citicoline added though it serves no selected goal');
    ok(!has(r2, 'collagen_uc2'), 'collagen added though it serves no selected goal');
    ok(!has(r2, 'probiotic'), 'probiotic added though it serves no selected goal');
  });

  // 1b — it may serve a selected goal by tag without being in that protocol's core
  t('1b. A tag-relevant active they take joins the box', function () {
    var base = engine.resolve(mk({ goals: ['Energy & vitality'] }));
    var withIt = engine.resolve(mk({ goals: ['Energy & vitality'], taking: ['vit_d3', 'l_theanine'] }));
    ok(!has(base, 'vit_d3'), 'vitamin D3 is in the energy core after all — pick another fixture');
    ok(has(withIt, 'vit_d3'), 'vitamin D3 not added though it is tagged energy and they take it');
    ok(has(withIt, 'l_theanine'), 'L-theanine not added though it is tagged energy and they take it');
  });

  // 1c — a substance we do not stock is never added to the box
  t('1c. Something off our shelf is never added', function () {
    var r = engine.resolve(mk({ goals: ['Sleep quality'], taking: ['melatonin', 'krill_oil', 'not_an_id'] }));
    ids(r).forEach(function (id) { ok(ING[id], id + ' is not one of the 15'); });
  });

  // 2 — Recent surgery → pause
  t('2. Recent surgery reaches the pause state', function () {
    var r = engine.resolve(mk({ goals: ['Joints & mobility'], conditions: ['Recent surgery'] }));
    ok(r.status === 'pause', 'expected pause, got ' + r.status);
    ok(r.deferReasons.length > 0, 'no defer reason surfaced for the pause copy');
  });

  // 3 — Recent surgery must not swap omega-3 <-> curcumin (each other's substitute)
  t('3. Recent surgery never substitutes omega-3 <-> curcumin', function () {
    var r = engine.resolve(mk({ goals: ['Joints & mobility'], conditions: ['Recent surgery'] }));
    ok(!has(r, 'omega3'), 'omega-3 present despite recent surgery');
    ok(!has(r, 'curcumin'), 'curcumin substituted in despite being blocked too');
  });

  // 4 — Kidney disease blocks creatine; taurine allowed where the protocol has it
  t('4. Kidney disease removes creatine, taurine still allowed', function () {
    var r = engine.resolve(mk({ goals: ['Energy & vitality'], conditions: ['Kidney disease'] }));
    ok(!has(r, 'creatine'), 'creatine present with kidney disease');
    ok(has(r, 'taurine'), 'taurine missing though the protocol allows it');
  });

  // 5 — Thyroid blocks ashwagandha silently (no user-facing warning about it)
  t('5. Thyroid condition removes ashwagandha silently', function () {
    var r = engine.resolve(mk({ goals: ['Sleep quality'], conditions: ['Thyroid condition'] }));
    ok(!has(r, 'ashwagandha'), 'ashwagandha present with thyroid condition');
    var leaked = r.sachet.some(function (s) {
      return (s.flags || []).join(' ').toLowerCase().indexOf('ashwagandha') !== -1;
    });
    ok(!leaked, 'ashwagandha removal leaked into a rendered flag');
  });

  // 6 — No gallbladder: emulsified + reduced dose on fat-solubles, plus enzymes
  t('6. No gallbladder → emulsified, reduced dose, enzymes enabled', function () {
    var r = engine.resolve(mk({ goals: ['Longevity'], conditions: ['No gallbladder'] }));
    ok(has(r, 'dig_enzymes'), 'digestive enzymes were not enabled');
    var fatsol = r.sachet.filter(function (s) { return ING[s.id].fat_soluble; });
    ok(fatsol.length > 0, 'no fat-soluble ingredient in the plan to check');
    fatsol.forEach(function (s) {
      ok(/emulsified/i.test(s.formNote || ''), s.id + ' missing emulsified form');
      ok(/-25%/.test(s.doseNote || ''), s.id + ' missing reduced dose');
    });
  });

  // 7 — sub-complaints must not change the box
  t('7. Sub-complaints do not change the plan', function () {
    var g = ['Sleep quality', 'Brain & memory'];
    var a = engine.resolve(mk({ goals: g, details: ['Trouble falling asleep', 'Brain fog'] }));
    var b = engine.resolve(mk({ goals: g, details: ['Wake up during the night', 'Forgetfulness'] }));
    var c = engine.resolve(mk({ goals: g, details: [] }));
    ok(JSON.stringify(ids(a)) === JSON.stringify(ids(b)), 'different sub-complaints changed the plan');
    ok(JSON.stringify(ids(a)) === JSON.stringify(ids(c)), 'ticking sub-complaints changed the plan');
  });

  // 8 — never exceed the age band pill cap (counted in PHYSICAL PILLS per day)
  t('8. Plan never exceeds the age-band pill cap (physical pills)', function () {
    var all = Object.keys(PROT).map(function (k) { return PROT[k].label; });
    [50, 57, 65, 74, 84].forEach(function (age) {
      var band = AGE.bands.filter(function (b) { return b.range === engine.ageBand(age); })[0];
      var r = engine.resolve(mk({ age: age, goals: all }));
      var pills = r.sachet.reduce(function (s, x) { return s + (x.units || 1); }, 0);
      ok(pills === r.pills, 'age ' + age + ': reported pills ' + r.pills + ' != summed ' + pills);
      ok(pills <= band.pill_cap, 'age ' + age + ': ' + pills + ' pills > cap ' + band.pill_cap);
      ok(pills <= r.pillCap, 'age ' + age + ': exceeded resolved cap');
    });
  });

  // 9 — every displayed dose matches ingredients.json exactly
  t('9. Every displayed dose matches ingredients.json', function () {
    var all = Object.keys(PROT).map(function (k) { return PROT[k].label; });
    var r = engine.resolve(mk({ goals: all, conditions: ['No gallbladder', 'On blood thinners'] }));
    r.sachet.forEach(function (s) {
      ok(s.dose === ING[s.id].dose, s.id + ' dose "' + s.dose + '" != "' + ING[s.id].dose + '"');
      ok(s.displayDose === ING[s.id].dose, s.id + ' displayDose drifted from ingredients.json');
    });
  });

  // 10 — each selected goal keeps at least two actives
  t('10. Every selected goal retains at least two supplements', function () {
    var all = Object.keys(PROT).map(function (k) { return PROT[k].label; });
    var r = engine.resolve(mk({ age: 84, goals: all }));   // tightest cap (10)
    var kept = ids(r);
    Object.keys(PROT).forEach(function (k) {
      var p = PROT[k];
      var n = p.core.filter(function (id) { return kept.indexOf(id) !== -1; }).length;
      ok(n >= 2, p.label + ' kept only ' + n + ' core actives');
    });
  });

  // 11 — switch: one plan dead, another viable. A lowered pill ceiling trims the
  // energy plan below its minimum while the sleep plan survives.
  t('11. Switch state keeps a viable plan and names the dead one', function () {
    var r = engine.resolve(mk({
      age: 50,
      goals: ['Sleep quality', 'Energy & vitality'],
      conditions: ['Hard to swallow pills']
    }));
    ok(r.status === 'switch', 'expected switch, got ' + r.status);
    ok(r.viablePlans.length > 0, 'no viable plan retained');
    ok(r.deadPlans.length > 0, 'no dead plan reported');
  });

  // 12 — blood thinners: omega-3 dose reduced, curcumin blocked
  t('12. Blood thinners reduce omega-3 and block curcumin', function () {
    var r = engine.resolve(mk({ goals: ['Heart health'], conditions: ['On blood thinners'] }));
    ok(!has(r, 'curcumin'), 'curcumin present on blood thinners');
    var o = r.sachet.filter(function (s) { return s.id === 'omega3'; })[0];
    ok(o, 'omega-3 missing from a heart plan');
    ok(/1000/.test(o.doseNote || ''), 'omega-3 dose not reduced');
  });

  // 13 — a condition still wins over "I already take it"
  t('13. A blocked active stays out even when they already take it', function () {
    var r = engine.resolve(mk({
      goals: ['Joints & mobility'], taking: ['curcumin'], conditions: ['On blood thinners']
    }));
    ok(!has(r, 'curcumin'), 'curcumin kept on blood thinners because they already take it');
    var r2 = engine.resolve(mk({
      goals: ['Sleep quality'], taking: ['ashwagandha'], conditions: ['Thyroid condition']
    }));
    ok(!has(r2, 'ashwagandha'), 'ashwagandha kept with a thyroid condition because they already take it');
  });

  // 14 — the pill ceiling still holds when they already take a lot
  t('14. Already taking everything never breaks the pill cap', function () {
    var all = Object.keys(PROT).map(function (k) { return PROT[k].label; });
    var everything = DATA.ingredients.map(function (i) { return i.id; });
    [50, 67, 84].forEach(function (age) {
      var r = engine.resolve(mk({ age: age, goals: all, taking: everything }));
      var pills = r.sachet.reduce(function (s, x) { return s + (x.units || 1); }, 0);
      ok(pills <= r.pillCap, 'age ' + age + ': ' + pills + ' pills > cap ' + r.pillCap);
    });
  });

  // 15 — never more actives in one box than max_supplements, whatever the input
  t('15. The box never holds more than max_supplements actives', function () {
    var cap = CFG.max_supplements;
    ok(typeof cap === 'number' && cap > 0, 'max_supplements is not configured');
    var all = Object.keys(PROT).map(function (k) { return PROT[k].label; });
    var everything = DATA.ingredients.map(function (i) { return i.id; });
    [50, 57, 67, 74, 84].forEach(function (age) {
      [[], everything].forEach(function (taking) {
        var r = engine.resolve(mk({ age: age, goals: all, taking: taking }));
        ok(r.sachet.length <= cap, 'age ' + age + ': ' + r.sachet.length + ' actives > cap ' + cap);
        ok(r.count === r.sachet.length, 'reported count drifted from the sachet');
        ok(r.suppCap === cap, 'resolved suppCap ' + r.suppCap + ' != configured ' + cap);
      });
    });
  });

  return results;
}

if (typeof module === 'object' && module.exports) {
  var fs = require('fs');
  var engine = require('../engine.js');
  var files = ['ingredients', 'protocols', 'conditions', 'substitutions', 'viability', 'age_tuning', 'engine_config'];
  var DATA = {};
  files.forEach(function (f) { DATA[f] = JSON.parse(fs.readFileSync(__dirname + '/../data/' + f + '.json', 'utf8')); });
  var res = buildSuite(engine, DATA);
  res.forEach(function (r) { console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '\n        ' + r.err)); });
  var failed = res.filter(function (r) { return !r.pass; }).length;
  console.log('\n' + (res.length - failed) + '/' + res.length + ' passed');
  process.exit(failed ? 1 : 0);
} else {
  this.WelmeEngineTests = { run: buildSuite };
}
