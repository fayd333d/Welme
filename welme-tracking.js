(function(window){
  'use strict';

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxg1FEwB5KIZwoEr6hOVpgH52wrLgVVxfKSoKveXtLYtiA2e6D4Q2XOXml_IOms_CjA/exec';
  var USER_ID_KEY = 'welme_user_id';
  var LANDING_PAGE_VIEW_FLAG = '__welmeLandingPageViewTracked';

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

  function trackLandingPageView(){
    if(window[LANDING_PAGE_VIEW_FLAG]) return Promise.resolve(false);
    window[LANDING_PAGE_VIEW_FLAG] = true;
    return trackEvent({ page: 'landing', event: 'page_view' });
  }

  window.WelmeTracking = {
    getUserId: getUserId,
    trackEvent: trackEvent,
    trackLandingPageView: trackLandingPageView
  };
})(window);
