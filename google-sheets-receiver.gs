/* Paste into Extensions > Apps Script in your spreadsheet.
 * Set Script Properties: SPREADSHEET_ID and SHARED_TOKEN, then deploy as a web app.
 */
function doPost(e) {
  function reply(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  }
  let lock;
  try {
    const body = JSON.parse(e.postData.contents);
    const properties = PropertiesService.getScriptProperties();
    const token = properties.getProperty('SHARED_TOKEN');
    if (!token || body.token !== token) throw new Error('Invalid shared token.');
    if (!['test', 'append'].includes(body.action)) throw new Error('Unknown action.');
    const name = String(body.sheetName || 'Juberu');
    if (name.length > 100 || /[\[\]:*?\/\\]/.test(name)) throw new Error('Invalid sheet tab name.');
    const spreadsheet = SpreadsheetApp.openById(properties.getProperty('SPREADSHEET_ID') || '1pIY489l8H1d-nhXwiZf55CvW9QgE5K_6WC_5rk8OpK8');
    if (body.action === 'test') {
      const existing = spreadsheet.getSheetByName(name);
      if (existing) {
        const expected = ['date', 'time', 'platform', 'title', 'client', 'skills', 'status', 'url'];
        const found = existing.getRange(1, 1, 1, 8).getDisplayValues()[0];
        if (found.some(Boolean) && found.some((value, index) => value.trim().toLowerCase() !== expected[index])) throw new Error('Columns A-H must be Date, Time, Platform, Title, Client, Skills, Status, Url.');
        if (existing.getMaxColumns() >= 9) {
          const idHeader = existing.getRange(1, 9).getDisplayValue();
          if (idHeader && idHeader !== 'Workana Bid ID') throw new Error('Column I is reserved for duplicate protection.');
        }
      }
      return reply({ ok: true, message: existing ? 'Connected to ' + name + '. No bid row was added.' : 'Connected. The tab will be created with the first bid.' });
    }
    const event = body.event;
    if (!event || !/^workana:[\w-]{1,500}$/.test(event.id) || !Number.isFinite(event.sentAt) || !Array.isArray(event.values) || event.values.length !== 8 || event.values.some(value => typeof value !== 'string' || value.length > 10000)) {
      throw new Error('Invalid bid event.');
    }
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
    if (sheet.getMaxColumns() < 9) sheet.insertColumnsAfter(sheet.getMaxColumns(), 9 - sheet.getMaxColumns());
    const headers = ['Date', 'Time', 'Platform', 'Title', 'Client', 'Skills', 'Status', 'Url', 'Workana Bid ID'];
    const current = sheet.getRange(1, 1, 1, 9).getDisplayValues()[0];
    if (current.slice(0, 8).every(value => !value) && !current[8]) {
      sheet.getRange(1, 1, 1, 9).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      if (current.slice(0, 8).some((value, index) => value.trim().toLowerCase() !== headers[index].toLowerCase())) throw new Error('Columns A-H must be Date, Time, Platform, Title, Client, Skills, Status, Url.');
      if (current[8] && current[8] !== headers[8]) throw new Error('Column I must be empty; it is reserved for duplicate protection.');
      if (!current[8] && sheet.getLastRow() > 1 && sheet.getRange(2, 9, sheet.getLastRow() - 1, 1).getDisplayValues().some(row => row[0])) throw new Error('Column I contains data; move it before enabling duplicate protection.');
      if (!current[8]) sheet.getRange(1, 9).setValue(headers[8]);
    }
    sheet.hideColumns(9);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1 && sheet.getRange(2, 9, lastRow - 1, 1).createTextFinder(event.id).matchEntireCell(true).findNext()) {
      return reply({ ok: true, id: event.id, duplicate: true });
    }
    const sent = new Date(event.sentAt);
    const values = event.values.slice();
    values[0] = Utilities.formatDate(sent, 'Asia/Tokyo', 'M/d/yyyy');
    values[1] = Utilities.formatDate(sent, 'Asia/Tokyo', 'h:mm:ss a');
    values[2] = 'Workana';
    // Prevent project titles or client names from being interpreted as formulas.
    const safe = values.map(value => /^[=+\-@]/.test(value) ? "'" + value : value);
    sheet.getRange(lastRow + 1, 1, 1, 9).setValues([[...safe, event.id]]);
    SpreadsheetApp.flush();
    return reply({ ok: true, id: event.id });
  } catch (error) {
    return reply({ ok: false, error: String(error.message || error).slice(0, 250) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
