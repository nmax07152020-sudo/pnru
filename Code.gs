/**
 * Antipolo City Health Office
 * Patient Navigation and Referral Unit - Dashboard API
 *
 * IMPORTANT:
 * 1. Open the Google Spreadsheet.
 * 2. Extensions > Apps Script (create a BOUND script).
 * 3. Paste this entire file into Code.gs.
 * 4. Host index.html separately on GitHub / Vercel.
 * 5. Run initializeAdmin() once from the Apps Script editor and authorize.
 * 6. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 */

const CONFIG = {
  PATIENT_SHEET: 'Patient/Client Assistance',
  HOSPITAL_SHEET: 'Hospital Referral Tally Board',
  START_YEAR: 2026,
  START_MONTH: 1, // January
  ADMIN_USERNAME: 'admin',
  TEMP_ADMIN_PASSWORD: 'CHO@2026Admin!',
  TOKEN_TTL_SECONDS: 21600 // 6 hours
};

/**
 * Serves public dashboard data as JSONP for a separately hosted page.
 */
function doGet(e) {
  const callback = e && e.parameter ? e.parameter.callback : '';
  if (callback) {
    const safeCallback = String(callback).replace(/[^\w.$]/g, '');
    let result;
    try {
      result = getDashboardData();
    } catch (err) {
      result = { success: false, message: err && err.message ? err.message : String(err) };
    }
    const payload = JSON.stringify(result);
    return ContentService
      .createTextOutput(safeCallback + '(' + payload + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'API is online. Use ?callback=yourCallback for JSONP dashboard data.'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reads the two requested worksheets and returns records from Jan 1, 2026 onward.
 * Patient columns: B=date, G=age, H=gender, I=classification, V=dispatching unit/brgy.
 * Hospital columns: A=hospital, B=date, G=remarks.
 * Dashboard separately counts:
 *   - Total hospital rows with a non-empty Column A value
 *   - COORDINATED entries in Column G
 *   - REFUSED entries in Column G
 */
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Open Apps Script from the target Google Sheet using Extensions > Apps Script.');

  // Resolve worksheet names flexibly: spaces, slash, hyphen and letter case
  // do not affect matching. This supports "PatientClient Assistance",
  // "Patient/Client Assistance", and "Patient Client Assistance".
  const patientSheet = findSheetByAliases_(ss, [
    CONFIG.PATIENT_SHEET,
    'Patient/Client Assistance',
    'Patient Client Assistance',
    'PatientClient Assistance'
  ]);
  const hospitalSheet = findSheetByAliases_(ss, [
    CONFIG.HOSPITAL_SHEET,
    'Hospital Referral Tally Board'
  ]);

  if (!patientSheet || !hospitalSheet) {
    const available = ss.getSheets().map(function(sh) { return sh.getName(); });
    throw new Error(
      'Required worksheet tab not found. ' +
      'Patient tab found: ' + (patientSheet ? patientSheet.getName() : 'NO') +
      '; Hospital tab found: ' + (hospitalSheet ? hospitalSheet.getName() : 'NO') +
      '. Spreadsheet: ' + ss.getName() +
      '. Available tabs: ' + available.join(' | ')
    );
  }

  const patientAssistance = readRows_(patientSheet, function(row) {
    const date = normalizeDate_(row[1]); // B
    if (!isFromStartDate_(date)) return null;
    return {
      date: date,
      age: row[6] === null || row[6] === undefined ? '' : row[6], // G
      gender: clean_(row[7]), // H
      classification: clean_(row[8]), // I
      dispatchUnit: clean_(row[21]) // V
    };
  });

  const hospitalTally = readRows_(hospitalSheet, function(row) {
    const date = normalizeDate_(row[1]); // B
    if (!isFromStartDate_(date)) return null;
    return {
      date: date,
      hospital: clean_(row[0]), // A
      remarks: clean_(row[6]) // G
    };
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    patientAssistance: patientAssistance,
    hospitalTally: hospitalTally
  };
}

/** Find a worksheet while ignoring spaces and punctuation in its tab name. */
function findSheetByAliases_(spreadsheet, aliases) {
  const normalize = function(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  };
  const wanted = aliases.map(normalize);
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (wanted.indexOf(normalize(sheets[i].getName())) !== -1) return sheets[i];
  }
  return null;
}

/** Read all used rows dynamically, so newly appended sheet rows are included. */
function readRows_(sheet, mapper) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  // Read at least through column V for the patient worksheet.
  const width = Math.max(lastCol, 22);
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const output = [];
  values.forEach(function(row) {
    const mapped = mapper(row);
    if (mapped) output.push(mapped);
  });
  return output;
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Convert Google Sheets Date values or mm/dd/yy text to ISO yyyy-MM-dd. */
function normalizeDate_(value) {
  if (value === null || value === undefined || value === '') return '';

  let d = null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    d = value;
  } else if (typeof value === 'number') {
    // Google Sheets serial date.
    d = new Date(Math.round((value - 25569) * 86400 * 1000));
  } else {
    const text = String(value).trim();
    let match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (match) {
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      // Patient sheet header specifies mm/dd/yy; hospital dates are native Date values.
      d = new Date(year, Number(match[1]) - 1, Number(match[2]));
    } else {
      const parsed = new Date(text);
      if (!isNaN(parsed.getTime())) d = parsed;
    }
  }

  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isFromStartDate_(isoDate) {
  if (!isoDate) return false;
  const parts = isoDate.split('-').map(Number);
  const year = parts[0], month = parts[1];
  return year > CONFIG.START_YEAR ||
    (year === CONFIG.START_YEAR && month >= CONFIG.START_MONTH);
}

/**
 * Run this ONCE from the Apps Script editor.
 * It stores a salted password hash, not the plain-text password.
 * Temporary credentials: username admin / password CHO@2026Admin!
 * Change the temporary password immediately after first login.
 */

/**
 * Private admin API endpoint.
 * Requests are proxied by the Vercel serverless function; the shared secret
 * is stored only in Script Properties and Vercel Environment Variables.
 */
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}');
  } catch (err) {
    return jsonOutput_({ success: false, message: 'Invalid JSON request.' });
  }

  const expectedSecret = PropertiesService.getScriptProperties().getProperty('VERCEL_API_SECRET');
  if (!expectedSecret || !constantTimeEquals_(String(body.apiSecret || ''), expectedSecret)) {
    return jsonOutput_({ success: false, message: 'Unauthorized API request.' });
  }

  const action = String(body.action || '');
  try {
    if (action === 'login') {
      const result = adminLogin(body.username, body.password);
      return jsonOutput_(result);
    }
    if (action === 'changePassword') {
      const result = changeAdminPassword(body.token, body.currentPassword, body.newPassword);
      return jsonOutput_(result);
    }
    if (action === 'logout') {
      const result = logoutAdmin(body.token);
      return jsonOutput_(result);
    }
    return jsonOutput_({ success: false, message: 'Unsupported admin action.' });
  } catch (err) {
    return jsonOutput_({ success: false, message: err && err.message ? err.message : String(err) });
  }
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function initializeAdmin() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_PASSWORD_HASH')) {
    Logger.log('Admin is already initialized. Existing password was not changed.');
    return 'Admin already initialized.';
  }
  const salt = Utilities.getUuid();
  props.setProperty('ADMIN_USERNAME', CONFIG.ADMIN_USERNAME);
  props.setProperty('ADMIN_PASSWORD_SALT', salt);
  props.setProperty('ADMIN_PASSWORD_HASH', hashPassword_(CONFIG.TEMP_ADMIN_PASSWORD, salt));
  Logger.log('Initial admin created. Username: admin | Temporary password: ' + CONFIG.TEMP_ADMIN_PASSWORD);
  Logger.log('Sign in and change this password immediately.');
  return 'Admin initialized. Username: admin. Temporary password is shown in the execution log.';
}

function adminLogin(username, password) {
  const props = PropertiesService.getScriptProperties();
  const savedUsername = props.getProperty('ADMIN_USERNAME');
  const savedHash = props.getProperty('ADMIN_PASSWORD_HASH');
  const salt = props.getProperty('ADMIN_PASSWORD_SALT');
  const cache = CacheService.getScriptCache();
  const normalizedUser = String(username || '').trim().toLowerCase();
  const attemptKey = 'ADMIN_FAIL_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalizedUser)
  ).slice(0, 32);
  const failures = Number(cache.get(attemptKey) || 0);

  if (failures >= 6) {
    return { success: false, message: 'Too many failed attempts. Please wait 15 minutes before trying again.' };
  }
  if (!savedHash || !salt) {
    return { success: false, message: 'Admin is not initialized. Run initializeAdmin() once in Apps Script.' };
  }
  if (normalizedUser !== String(savedUsername || '').toLowerCase() ||
      hashPassword_(String(password || ''), salt) !== savedHash) {
    cache.put(attemptKey, String(failures + 1), 900);
    return { success: false, message: 'Incorrect username or password.' };
  }

  cache.remove(attemptKey);
  const token = Utilities.getUuid();
  cache.put('ADMIN_TOKEN_' + token, 'admin', CONFIG.TOKEN_TTL_SECONDS);
  return { success: true, token: token, expiresIn: CONFIG.TOKEN_TTL_SECONDS };
}

function changeAdminPassword(token, currentPassword, newPassword) {
  if (!isValidAdminToken_(token)) {
    return { success: false, message: 'Your admin session expired. Please sign in again.' };
  }
  const newPass = String(newPassword || '');
  if (newPass.length < 8) {
    return { success: false, message: 'New password must be at least 8 characters.' };
  }

  const props = PropertiesService.getScriptProperties();
  const oldSalt = props.getProperty('ADMIN_PASSWORD_SALT');
  const oldHash = props.getProperty('ADMIN_PASSWORD_HASH');
  if (hashPassword_(String(currentPassword || ''), oldSalt) !== oldHash) {
    return { success: false, message: 'Current password is incorrect.' };
  }

  const newSalt = Utilities.getUuid();
  props.setProperty('ADMIN_PASSWORD_SALT', newSalt);
  props.setProperty('ADMIN_PASSWORD_HASH', hashPassword_(newPass, newSalt));
  return { success: true, message: 'Password changed successfully.' };
}

function isValidAdminToken_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('ADMIN_TOKEN_' + String(token)) === 'admin';
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(bytes);
}

/** Optional: remove all active admin login sessions. */
function logoutAdmin(token) {
  if (token) CacheService.getScriptCache().remove('ADMIN_TOKEN_' + String(token));
  return { success: true };
}
