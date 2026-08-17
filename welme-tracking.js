(function(window){
  'use strict';

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxg1FEwB5KIZwoEr6hOVpgH52wrLgVVxfKSoKveXtLYtiA2e6D4Q2XOXml_IOms_CjA/exec';
  var USER_ID_KEY = 'welme_user_id';
  var LANDING_PAGE_VIEW_FLAG = '__welmeLandingPageViewTracked';

  /* ── Ad attribution ──────────────────────────────────────────────────────
   * Counts email submissions per ad campaign, in its own sheet. Deliberately
   * carries no user id and no email address: the row is the count.
   *
   * PASTE THE /exec URL OF THE AD-CONVERSION APPS SCRIPT HERE.
   * Until it is filled in, the ad tracking quietly does nothing.           */
  var AD_ENDPOINT = '';

  var UTM_KEY = 'welme_utm';
  var EMAIL_COUNTED_KEY = 'welme_email_counted';
  var UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  var ALLOWED_EVENTS = {
    landing: { page_view: true },
    quiz: { quiz_start: true, quiz_finish: true },
    results: { landing_click: true, email_submit: true }
  };

  function makeId(){
    if(window.crypto && window.crypto.randomUUID){
      return 'welme_' + window.crypto.randomUUID();
    }
    return 'welme_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
  }

  function getUserId(){
    try{
      var existing = window.localStorage.getItem(USER_ID_KEY);
      if(existing) return existing;
      var userId = makeId();
      window.localStorage.setItem(USER_ID_KEY, userId);
      return userId;
    }catch(error){
      console.error('Welme tracking could not access localStorage for user id.', error);
      return makeId();
    }
  }

  function startsLikeFormula(value){
    return /^[=+\-@\t\r]/.test(value);
  }

  function safeCell(value){
    if(value == null) return '';
    var text = String(value);
    return startsLikeFormula(text) ? "'" + text : text;
  }

  function normalisePayload(input){
    input = input || {};
    var page = String(input.page || '');
    var event = String(input.event || '');
    if(!ALLOWED_EVENTS[page] || !ALLOWED_EVENTS[page][event]){
      console.error('Welme tracking rejected unsupported event.', { page: page, event: event });
      return null;
    }

    var userId = getUserId();
    var age = '';
    var gender = '';
    var goal = '';
    var details = '';
    var weight = '';
    var height = '';
    var problems = '';

    if(page === 'quiz' && event === 'quiz_finish'){
      age = safeCell(input.age || '');
      gender = safeCell(input.gender || '');
      goal = safeCell(input.goal || '');
      details = safeCell(input.details || '');
      weight = safeCell(input.weight || '');
      height = safeCell(input.height || '');
      problems = safeCell(input.problems || '');
    }

    return {
      timestamp: new Date().toISOString(),
      id: safeCell(userId),
      page: safeCell(page),
      event: safeCell(event),
      age: age,
      gender: gender,
      goal: goal,
      details: details,
      weight: weight,
      height: height,
      problems: problems,
      email: event === 'email_submit' ? safeCell(input.email || '') : '',
      results: event === 'email_submit' ? safeCell(input.results || '') : ''
    };
  }

  function postPayload(payload, options){
    options = options || {};
    var body = JSON.stringify(payload);
    var useBeacon = !!options.keepalive && !!window.navigator && !!window.navigator.sendBeacon;

    try{
      if(useBeacon){
        var queued = window.navigator.sendBeacon(
          ENDPOINT,
          new Blob([body], { type: 'text/plain;charset=UTF-8' })
        );
        if(queued) return Promise.resolve(true);
      }
    }catch(error){
      console.error('Welme tracking sendBeacon failed; falling back to fetch.', error);
    }

    try{
      return window.fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: !!options.keepalive,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body
      }).then(function(){ return true; }).catch(function(error){
        console.error('Welme tracking request failed.', error);
        return false;
      });
    }catch(error){
      console.error('Welme tracking could not start request.', error);
      return Promise.resolve(false);
    }
  }

  function trackEvent(input, options){
    try{
      var payload = normalisePayload(input);
      if(!payload) return Promise.resolve(false);
      return postPayload(payload, options);
    }catch(error){
      console.error('Welme tracking failed without blocking the user flow.', error);
      return Promise.resolve(false);
    }
  }

  /* First touch wins: the ad that brought someone in is the one credited,
   * even if they come back later by typing the address directly. Runs on
   * every page that loads this file, so it works whether the ad points at
   * the landing page or straight at the quiz. */
  function captureAttribution(){
    try{
      var params = new window.URLSearchParams(window.location.search);
      var found = null;
      for(var i = 0; i < UTM_FIELDS.length; i++){
        var value = params.get(UTM_FIELDS[i]);
        if(value){
          found = found || {};
          found[UTM_FIELDS[i]] = String(value).slice(0, 120);
        }
      }
      if(!found) return;
      if(window.localStorage.getItem(UTM_KEY)) return;   // keep the first touch
      window.localStorage.setItem(UTM_KEY, JSON.stringify(found));
    }catch(error){
      console.error('Welme tracking could not capture campaign parameters.', error);
    }
  }

  function getAttribution(){
    try{
      var stored = window.localStorage.getItem(UTM_KEY);
      return stored ? JSON.parse(stored) : null;
    }catch(error){
      return null;
    }
  }

  /* One row per person who submits an email, tagged with the campaign.
   * Counted once per browser so the sheet answers "how many users", not
   * "how many submissions". */
  function trackAdConversion(){
    if(!AD_ENDPOINT) return Promise.resolve(false);
    try{
      if(window.localStorage.getItem(EMAIL_COUNTED_KEY)) return Promise.resolve(false);
    }catch(error){ /* private mode: fall through and count it */ }

    var utm = getAttribution() || {};
    var payload = { timestamp: new Date().toISOString() };
    for(var i = 0; i < UTM_FIELDS.length; i++){
      payload[UTM_FIELDS[i]] = safeCell(utm[UTM_FIELDS[i]] || '');
    }
    if(!payload.utm_source) payload.utm_source = '(direct)';

    var body = JSON.stringify(payload);
    try{
      if(window.navigator && window.navigator.sendBeacon){
        window.navigator.sendBeacon(
          AD_ENDPOINT,
          new Blob([body], { type: 'text/plain;charset=UTF-8' })
        );
      }else{
        window.fetch(AD_ENDPOINT, {
          method: 'POST',
          mode: 'no-cors',
          keepalive: true,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: body
        }).catch(function(){});
      }
      try{ window.localStorage.setItem(EMAIL_COUNTED_KEY, '1'); }catch(e){}
      return Promise.resolve(true);
    }catch(error){
      console.error('Welme ad tracking failed without blocking the user flow.', error);
      return Promise.resolve(false);
    }
  }

  function trackLandingPageView(){
    if(window[LANDING_PAGE_VIEW_FLAG]) return Promise.resolve(false);
    window[LANDING_PAGE_VIEW_FLAG] = true;
    return trackEvent({ page: 'landing', event: 'page_view' });
  }

  captureAttribution();

  window.WelmeTracking = {
    getUserId: getUserId,
    trackEvent: trackEvent,
    trackLandingPageView: trackLandingPageView,
    getAttribution: getAttribution,
    trackAdConversion: trackAdConversion
  };
})(window);
