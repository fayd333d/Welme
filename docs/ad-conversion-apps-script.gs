/**
 * Welme — ad conversion counter.
 *
 * Receives one row each time someone submits their email on the results page,
 * tagged with the campaign that first brought them to the site. Deliberately
 * stores no user id and no email address: the row itself is the count, so this
 * sheet holds no personal data.
 *
 * This file is the source of truth for a script that lives in Google, not in
 * this repo. It is kept here so the sheet's columns and the payload sent by
 * welme-tracking.js stay in step.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 *  1. Create a NEW Google Sheet (do not reuse the main tracking sheet).
 *  2. Extensions → Apps Script. Delete the placeholder, paste this file, Save.
 *  3. Deploy → New deployment → gear icon → Web app.
 *        Description:      welme ad conversions
 *        Execute as:       Me
 *        Who has access:   Anyone            ← required; the browser posts
 *                                              without signing in
 *  4. Authorise when prompted (the "unverified app" warning is expected for
 *     your own script — Advanced → Go to project).
 *  5. Copy the deployment's /exec URL into AD_ENDPOINT at the top of
 *     welme-tracking.js.
 *
 * ── Re-deploying after an edit ───────────────────────────────────────────
 *  Deploy → Manage deployments → pencil → Version: New version → Deploy.
 *  Keeps the same /exec URL. Creating a *new deployment* instead gives a new
 *  URL and silently strands the site on the old one.
 */

var SHEET_NAME = 'email_submits';
var HEADERS = [
  'timestamp',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term'
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var row = HEADERS.map(function (key) {
      return data[key] == null ? '' : String(data[key]);
    });
    getSheet_().appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Lets you open the /exec URL in a browser to confirm the deployment is live. */
function doGet() {
  return json_({ ok: true, service: 'welme-ad-conversions' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
