// The page a client sees when their Claude asks to connect: the client portal's
// own look (its login card, logo and colours), one field for the access key.
// Plain server-rendered HTML with no scripts, no outside requests, and headers
// that stop it being framed or cached.

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

const STYLE = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:linear-gradient(135deg,#EFF6FF,#EEF2FF);color:#0F172A}
.card{width:100%;max-width:420px;background:rgba(255,255,255,.88);border:1px solid rgba(255,255,255,.6);
  border-radius:28px;box-shadow:0 8px 30px rgba(0,0,0,.05);padding:32px 28px}
.logo{display:block;width:88px;height:88px;border-radius:50%;padding:5px;background:#C0C0C0;margin:0 auto 18px;box-shadow:0 6px 16px rgba(0,0,0,.12)}
.logo img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
h1{margin:0;text-align:center;font-size:24px;font-weight:700;letter-spacing:-.3px}
.sub{margin:8px 0 22px;text-align:center;font-size:14px;line-height:1.55;color:#64748B}
ul{margin:0 0 22px;padding:14px 16px 14px 34px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:16px;font-size:13.5px;line-height:1.6;color:#334155}
li+li{margin-top:4px}
label{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748B;margin:0 0 8px}
input[type=password]{width:100%;padding:14px 16px;font-size:16px;font-weight:500;letter-spacing:.04em;text-align:center;color:#0F172A;
  background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;outline:none}
input[type=password]:focus{border-color:#3B82F6;box-shadow:0 0 0 3px rgba(59,130,246,.18)}
button{margin-top:14px;width:100%;padding:15px;font-size:15px;font-weight:600;color:#fff;background:#0F172A;border:0;border-radius:14px;cursor:pointer}
button:active{transform:scale(.98)}
.error{margin:12px 0 0;padding:11px 14px;border-radius:12px;background:#FEF2F2;color:#B91C1C;font-size:13.5px;line-height:1.5;text-align:center}
.foot{margin:20px 0 0;text-align:center;font-size:12px;line-height:1.5;color:#94A3B8}
`;

function layout(title: string, body: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main class="card"><span class="logo"><img src="/brand-logo.jpg" alt="Rai Sun"></span>${body}</main></body></html>`;
}

function headers(formAction: string[]): Record<string, string> {
    return {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        // form-action must also allow the address the sign-in result is sent to, since
        // browsers apply it to the redirect after the form is submitted.
        'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' ${formAction.join(' ')}; frame-ancestors 'none'; base-uri 'none'`,
    };
}

export type SignInParams = {
    client_id: string;
    redirect_uri: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
    scope: string;
    resource: string;
};

export function signInPage(params: SignInParams, appName: string | null, error?: string, status = 200): Response {
    const hidden = (Object.keys(params) as (keyof SignInParams)[])
        .map((k) => `<input type="hidden" name="${k}" value="${esc(params[k] || '')}">`)
        .join('');
    const body = `
<h1>Connect Claude</h1>
<p class="sub">Enter the access key you use to sign in to your Rai Sun portal.</p>
<ul>
  <li>Claude will see your projects, features, payments and activity.</li>
  <li>It can send requests to Rai Sun for you: new projects, features and renames.</li>
  <li>It only ever sees your own portal. Rai Sun can disconnect it at any time.</li>
</ul>
<form method="post" action="/oauth/authorize" autocomplete="off">
  ${hidden}
  <label for="key">Access key</label>
  <input id="key" name="access_key" type="password" required minlength="3" maxlength="200" autofocus autocapitalize="off" spellcheck="false" placeholder="Your access key">
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
  <button type="submit">Connect</button>
</form>
<p class="foot">Requested by ${esc(appName || 'Claude')}. Your key is checked here and never shared with Claude.</p>`;
    return new Response(layout('Connect Claude · Rai Sun', body), { status, headers: headers([new URL(params.redirect_uri).origin]) });
}

export function errorPage(message: string, status = 400): Response {
    const body = `<h1>Can’t connect</h1><p class="sub">${esc(message)}</p><p class="foot">Start again from Claude: Settings → Connectors.</p>`;
    return new Response(layout('Can’t connect · Rai Sun', body), { status, headers: headers([]) });
}
