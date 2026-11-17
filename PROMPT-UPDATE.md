The Templates editor now uses a single Proposal prompt instead of point count,
point icons, individual point instructions, and minimum/maximum word controls.
Existing point instructions are copied into the prompt automatically. Edit the
prompt and click Save template to control proposal content, format, and length.

Proposal prose, greeting, and closing use the project description's language.
The title is a fallback when the description's language cannot be determined.
Signature and proper names are retained. Truthfulness and Workana contact and
payment restrictions still apply.

Reload the unpacked extension at chrome://extensions, then refresh Workana.
Run local regression checks with: node --test proposal-prompt.test.cjs
