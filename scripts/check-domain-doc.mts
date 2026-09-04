// Guards against PORTAL_DOMAIN.md drifting from the code it documents.
import { readFileSync } from "node:fs";
const doc = readFileSync("docs/PORTAL_DOMAIN.md", "utf8");
const required = ["Requested", "Approved", "Working", "Updating", "Completed"];
const missing = required.filter(s => !doc.includes(s));
if (missing.length) { console.error("DOMAIN DOC OUT OF DATE - missing statuses:", missing.join(", ")); process.exit(1); }
if (!doc.includes("per_feature") || !doc.includes("package")) { console.error("DOMAIN DOC missing a billing mode"); process.exit(1); }
console.log("domain doc OK");
