# DCO Management Tool – Full Operational Plan

How Creator evolves into a Dynamic Creative Optimisation (DCO) management tool. Based on the 2026 landscape in `dcoreference.md`.

---

## Executive Summary

**Goal:** Transform Creator from a banner production tool into a DCO management platform positioned in the *Infrastructure & Automation Specialists* segment (Abyssale, Bannerflow, Cape.io).

**Strategy:** Phased rollout—hub first, then variant engine, then productised platform with auth and teams.

**Timeline:**

| Phase | Scope | Target |
|-------|--------|--------|
| Phase 1 | DCO hub page | Week 1 |
| Phase 2 | Template + Variant Generator | Week 2–4 |
| Phase 3 | Firebase Auth + Firestore | Week 5–8 |
| Phase 4 | Full DCO platform | Ongoing |

---

## Part A: Operational Readiness

### Dev Environment

- [ ] **Node.js 18+** – Check with `node -v`
- [ ] **npm** – Dependencies via `npm run install:all`
- [ ] **Local dev** – `npm run dev` (client + server concurrently)
- [ ] **Client** – Vite at `http://localhost:5173`
- [ ] **Server** – Express at `http://localhost:3001` (social/website APIs)

### Deployment

- [ ] **Firebase project** – `creator-d86c1` (see `.firebaserc`)
- [ ] **Build** – `npm run build` → outputs to `client/dist`
- [ ] **Deploy** – `npm run deploy` or `npm run deploy:hosting`
- [ ] **CI** – GitHub Actions (`.github/workflows/deploy.yml`) deploys on push to `main`
- [ ] **Note:** Social/Website scraping APIs require a backend; currently only static hosting is deployed. Options: Cloud Functions, separate server, or exclude those features in production.

### Testing Before Release

- [ ] Manual smoke test: Home, Manual Editor, Social, Website Assets, MP4 Converter, DCO
- [ ] Export: CM360 zip downloads correctly
- [ ] Build passes: `npm run build` with no errors

---

## Part B: Current State

**Creator today:**

| Tool | Purpose | Backend |
|------|---------|---------|
| Manual Editor | Design banners, export to CM360 | Client |
| Social Generator | URL → 300×600/300×250 banners | Node API |
| Website Assets | Extract assets from URL | Node API |
| MP4 Converter | Bulk MP4 → HTML5 video banners | Client |

**Tech:** React + Vite, Firebase Hosting (static), Express server (dev).

**Positioning:** Production-first, multi-platform export (CM360, TTD, Amazon DSP, StackAdapt).

---

## Part C: Phased Roadmap

### Phase 1: DCO Hub Page ✅

**Status:** Implemented.

**Deliverables:**

- [x] Route `/dco`
- [x] DCO page with: hero, What is DCO?, Market segments, Capabilities gap, Tools links, Roadmap CTA
- [x] Nav item "DCO"
- [x] Home page card for DCO

**No auth, no Firestore.**

---

### Phase 2: Template + Variant Generator

**Status:** Planned.

**Scope:**

- Template builder (or reuse Manual Editor output)
- CSV/JSON feed upload
- Generate N variants from template + feed
- Bulk export (zip) via existing `cm360Export`
- Persist templates in `localStorage` or Firestore (optional)

**Tasks:**

- [ ] Define template schema (layers, placeholders, rules)
- [ ] `FeedUploader` – CSV/JSON parse, column mapping
- [ ] `VariantPreview` – list/grid of generated variants
- [ ] `VariantExport` – bulk zip using `createCM360ZipBlob`
- [ ] Wire template placeholders → feed row data → HTML
- [ ] Decide: `localStorage` vs Firestore (no auth)

**Effort:** ~2–3 weeks.

---

### Phase 3: Firebase Auth + Firestore

**Status:** Future.

**Scope:**

- Firebase Authentication (email/password, Google)
- Firestore: campaigns, templates, feeds, asset metadata
- Cloud Storage: asset uploads
- Per-user data, optional sharing

**Tasks:**

- [ ] Enable Firebase Auth and Firestore in console
- [ ] Add Auth context/provider
- [ ] Migrate templates/feeds to Firestore collections
- [ ] Add login/signup UI
- [ ] Basic RBAC (viewer, editor, admin)
- [ ] Move API to Cloud Functions if needed for production

**Effort:** ~3–4 weeks.

---

### Phase 4: Full DCO Platform

**Status:** Future.

**Scope:**

- Approval workflows (draft → review → approved)
- Global vs local governance (Cape.io-style)
- Feed integrations (Shopify, CRM, custom APIs)
- Trafficking automation, compliance checks
- Usage analytics, billing

**Effort:** Ongoing product development.

---

## Part D: Architecture Decisions

### Auth: When to Add

| Use case | Auth? |
|---------|-------|
| DCO hub, simple variant generator | No |
| Shared templates across devices | Optional (Firestore + anonymous) |
| Teams, approval, enterprise | Yes |

### Firebase Services (Phase 3+)

1. **Authentication** – Email, Google, optional SSO
2. **Cloud Firestore** – Campaigns, templates, feeds
3. **Cloud Storage** – Assets, exports
4. **Cloud Functions** – Feed processing, API (optional)

### Positioning vs dcoreference.md

| Segment | Vendors | Creator |
|---------|---------|---------|
| Enterprise Giants | Celtra, Innovid | Not competing |
| Performance/Social | Smartly, Hunch | Partial overlap (Social Generator) |
| **Infrastructure** | Abyssale, Bannerflow, Cape.io | **Primary fit** |
| AI Challengers | Segwise, Marpipe | Future add-on |

**Differentiation:** Mid-market, usage-based, predictable costs. One designer scaling hundreds of variants without enterprise overhead.

---

## Part E: Execution Checklist

### Phase 1 (Complete)

- [x] Create `client/src/pages/DCOPage.tsx`
- [x] Add route `/dco` in `App.tsx`
- [x] Add nav item in `Layout.tsx`
- [x] Add home page card in `HomePage.tsx`
- [x] Content: What is DCO, Market segments, Capabilities gap, Tools links, Roadmap CTA

### Phase 2 (Next)

- [ ] Template schema design
- [ ] FeedUploader component
- [ ] VariantPreview component
- [ ] VariantExport + bulk zip
- [ ] Persistence (localStorage or Firestore)

### Phase 3 (Later)

- [ ] Firebase Auth setup
- [ ] Firestore collections
- [ ] Auth UI
- [ ] Migrate Phase 2 to Firestore

---

## References

- `dcoreference.md` – 2026 DCO landscape, vendors, capabilities gap
- `client/src/services/cm360Export.ts` – Export pipeline for Phase 2
- `.github/DEPLOY-SETUP.md` – Firebase deploy setup
