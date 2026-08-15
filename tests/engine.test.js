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

  // 1 — dedupe: already taking magnesium, omega-3 and D3 → none of the three appear
  t('1. Dedupe removes what the user already takes', function () {
    var r = engine.resolve(mk({
      goals: ['Sleep quality', 'Heart health', 'Longevity'],
      taking: ['mag_glycinate', 'omega3', 'vit_d3']
    }));
    ok(!has(r, 'mag_glycinate'), 'magnesium was re-recommended');
    ok(!has(r, 'omega3'), 'omega-3 was re-recommended');
    ok(!has(r, 'vit_d3'), 'vitamin D3 was re-recommended');
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

  // 11 — switch: one plan dead, another viable
  t('11. Switch state keeps a viable plan and names the dead one', function () {
    var r = engine.resolve(mk({
      goals: ['Digestion & gut', 'Sleep quality'],
      taking: ['probiotic', 'dig_enzymes']       // guts the digestion plan only
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
