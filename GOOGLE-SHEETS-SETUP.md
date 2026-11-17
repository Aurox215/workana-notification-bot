# Connect your Juberu bid log

Destination: [your Google spreadsheet](https://docs.google.com/spreadsheets/d/1pIY489l8H1d-nhXwiZf55CvW9QgE5K_6WC_5rk8OpK8/edit?gid=415237413#gid=415237413), tab **Juberu**.

The extension records confirmed successful manual and automatic bids. The visible
columns match your screenshot:

| Date | Time | Platform | Title | Client | Skills | Status | Url |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 11/10/2026 | 5:33:00 PM | Workana | Project title | Client name | React, JavaScript | On Hold | Conversation or project URL |

Both date and time use **Asia/Tokyo (JST, UTC+9)** and the actual confirmation
timestamp. The receiver calculates them again, independently of your computer's
time zone. Missing client names are left blank. Status starts as **On Hold**;
change the default in Settings if desired. You can update statuses in the sheet
without retries overwriting them.

## One-time Google setup

1. Open your spreadsheet and choose **Extensions > Apps Script**.
2. Replace the editor contents with [google-sheets-receiver.gs](google-sheets-receiver.gs), then save.
3. Open **Project Settings > Script properties > Add script property**.
   Add `SHARED_TOKEN`, using a long random secret of your choice. You will paste
   the same secret into the extension. The script already contains your
   spreadsheet ID. To change spreadsheets later, set `SPREADSHEET_ID` as well.
4. Choose **Deploy > New deployment > Web app**. Set **Execute as: Me** and
   **Who has access: Anyone**. Authorize the script for your spreadsheet and deploy.
   The receiver checks the shared token on every request.
5. Copy the deployed URL, which looks like
   `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.
   The spreadsheet's `docs.google.com` URL cannot receive bid records itself.
6. Reload the extension at `chrome://extensions` and refresh Workana. Open
   **Settings > Google Sheets bid log**. Paste the web app URL and token, keep
   the tab name **Juberu**, enable logging, and click **Save Google Sheets settings**.
7. Click **Test connection**. This checks access and the existing column headers
   without adding a bid row. Your next confirmed bid will append a row.

Google documents [web app deployment](https://developers.google.com/apps-script/guides/web)
and [ContentService responses](https://developers.google.com/apps-script/reference/content/content-service).

The first row must contain the eight headers above, in order (case does not
matter). Empty tabs receive these headers automatically. Column **I** must be
empty; it stores a hidden **Workana Bid ID** for duplicate protection. Do not
delete that column. Existing rows in A-H are retained, and new records append
after the last used row. If your sheet has prefilled empty bid rows, new records
append below those rows.

## Delivery and retries

- Only confirmed submissions are logged. Drafts and unconfirmed receipts are not.
- Bids confirmed while logging is disabled are not backfilled automatically.
- Pending records are saved locally and survive browser or extension restarts.
- Failed deliveries retry once due, with increasing delays up to one hour.
  Settings displays the pending count and most recent error. **Retry pending rows**
  attempts them immediately using the currently saved connection settings.
- A retry after a lost response finds the existing hidden ID and returns success
  without inserting another row or changing a manually edited status.
- A sheet delivery failure does not submit another bid or stop bidding.
- If you edit the receiver script, deploy a new version of the web app before
  testing again. If your Google account does not allow the **Anyone** deployment
  option, this receiver setup cannot be used with that account's restrictions.

## JSON settings backups

Under **Settings > Import / export all settings**, use **Export settings JSON**
and **Import settings JSON**. The backup includes the proposal prompt, greeting,
closing, signature, bid requirements, portfolio, filters, model, appearance,
panel position and Google Sheets settings. Only saved settings are exported.

The Google Sheets shared token is included. Select **Include OpenAI API key in
exported JSON** to include the key too. Import restores that key's persistent or
session-only storage preference; if no key is included, your current key remains.

Stop bidding before importing. Import replaces saved settings after validating
the file. Current bids, bid history, pending sheet deliveries and logs are kept
separately and are not imported from a settings backup. A legacy `{ "config": ... }`
export or a raw extension config object can also be imported.

Local checks: `node --test *.test.cjs`.
