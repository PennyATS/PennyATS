# Public careers page

PennyATS serves open, non-confidential jobs at `/careers` and each role at `/careers/{slug}` with an apply form. No candidate account is required. Set `APP_URL` to the public origin candidates will see (invite links, JobPosting structured data, and secure cookies all use it).

This page covers how to put that experience on the company's own domain or subpath so search ranking benefits the company. Visual branding for the careers surface is tracked separately ([#25](https://github.com/PennyATS/PennyATS/issues/25)).

## JobPosting structured data

Each public job page emits [schema.org `JobPosting`](https://schema.org/JobPosting) JSON-LD (title, description, `datePosted`, hiring organization, location or remote signals, employment type, and public pay when shown). Google can use it for [job search rich results](https://developers.google.com/search/docs/appearance/structured-data/job-posting). After deploy, paste a live job URL into [Google's Rich Results Test](https://search.google.com/test/rich-results) to validate.

The company name comes from Settings (the same value used in email templates). If unset, it falls back to the product name.

## Serving careers on your domain

PennyATS is one Next.js app. The careers routes live on the same origin as the rest of the product unless you put a reverse proxy in front. Three common patterns:

### 1. Reverse proxy on a careers subdomain (recommended)

Point `careers.acme.com` at the same PennyATS process as `ats.acme.com`, or dedicate the install to careers-only browsing. Terminate TLS at the proxy and forward to the app.

Example with Caddy (proxy only careers paths, or the whole app):

```caddy
careers.acme.com {
  reverse_proxy 127.0.0.1:3000
}
```

Example with Nginx:

```nginx
server {
  listen 443 ssl;
  server_name careers.acme.com;
  # ssl_certificate …;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Set `APP_URL=https://careers.acme.com` when this origin is what candidates and Google should see. If the ATS UI stays on another hostname, run two proxies to the same app, or two installs; JobPosting URLs follow whichever `APP_URL` that process has.

### 2. Subpath on the company website (`acme.com/careers`)

Put the company site and PennyATS behind one reverse proxy. Forward `/careers` (and `/careers/…`) to PennyATS; leave the rest of the site on your CMS or static host.

```nginx
location /careers {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

PennyATS serves careers at the `/careers` path already, so no path rewrite is required when the public URL is `https://acme.com/careers`. Set `APP_URL=https://acme.com` so JobPosting `url` values and absolute links match that origin. Resume uploads and the apply POST stay on the same host under `/careers/…`.

If you also need the signed-in ATS on the same domain, forward the rest of the app (for example `/login`, `/jobs`) the same way, or keep the ATS on a separate subdomain as in option 1.

### 3. Standalone install

Deploy PennyATS on its own hostname (`https://jobs.acme.com`), set `APP_URL` to that origin, and link to `/careers` from the company site. Simplest operationally; the company site keeps a normal outbound link. Structured data still uses the standalone origin.

### Embed (iframe)

You can iframe `/careers` or a job page from the company site. Prefer reverse proxy or standalone instead: iframes hurt SEO (JobPosting on an embedded URL is attributed to the framed origin), and cookie/SameSite rules can complicate apply flows. If you must embed for a temporary landing page, still keep a crawlable, non-framed URL for each job.

## Apply completion funnel

Each public job page records anonymous counts: **views** (page load), **starts** (first focus on the apply form), and **submits** (successful application). No candidate details are stored. Admins and recruiters see the funnel on **Reports** (table `apply`, also available through the API and MCP).

## Mobile and accessibility

The public careers layout is mobile-first: full-width job cards, 16px inputs (so iOS does not zoom on focus), at least 44px-tall controls, a skip link into the main content, labeled fields with a required-field hint, fieldsets for details and resume, and a focused error alert when validation fails. Playwright covers phone and desktop apply flows in `apps/web/tests/integration/careers-apply.spec.ts`. For a WCAG 2.2 AA pass on a deployment, run [axe DevTools](https://www.deque.com/axe/devtools/) or [WAVE](https://wave.webaim.org/) against `/careers` and a job apply page after you set company branding and a privacy notice.

## Checklist

1. Set `APP_URL` to the public `https://` origin candidates will use.
2. Open a job (status Open, not confidential) and confirm `/careers/{slug}` loads over that origin.
3. Validate JobPosting JSON-LD with the Rich Results Test.
4. Confirm the apply form posts successfully (resume size limits still apply; see the form help text).
5. After a few test applies, confirm **Reports → Careers apply funnel** shows views, starts, and submits.
6. Spot-check the apply form on a phone and with a keyboard (Tab order, skip link, error focus).
