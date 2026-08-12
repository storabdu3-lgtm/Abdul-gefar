# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains an API server artifact and the main inventory management system frontend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9

## Artifacts

### inventory-system (artifacts/inventory-system)
Multi-Store E-commerce + Inventory Management System

- **Framework**: React + Vite (TypeScript)
- **Database**: Firebase Firestore (client-side direct access)
- **Auth**: Firebase Authentication + custom user profile/permissions in Firestore
- **Image upload**: Cloudinary (unsigned preset)
- **UI**: Tailwind CSS v4, shadcn/ui components, indigo/slate theme
- **Routing**: Wouter
- **State**: React Query + local useState
- **Packages**: react-barcode, react-to-print, jspdf, xlsx

#### Routes
- `/` → Ecommerce storefront (no sidebar, public)
- `/login` → Sign In page (first-time shows admin setup)
- `/dashboard` and all other management pages → protected, require auth + permission

#### Auth System
- `src/lib/firebase.ts` — exports `db`, `storage`, `auth`
- `src/lib/auth.tsx` — `AuthProvider`, `useAuth` hook, `ALL_PERMISSIONS` list
- Login: Firebase Auth (email/password)
- First visit: shows "Create Admin Account" form; creates Firebase Auth user + Firestore `users` doc
- Admin creates additional users via Firebase REST API (no admin sign-out), stores profile in Firestore `users` collection (doc ID = Firebase UID)
- Permissions: admin has all; normal users have array of page slugs
- Protected routes: `ProtectedPage` wrapper checks `hasPermission(page)`, shows "Access Denied" if unauthorized

#### Modules (all fully built)
1. **Dashboard** — overview stats
2. **E-commerce** — standalone storefront at `/`, Sign In button links to `/login`
3. **Products** — CRUD with Cloudinary upload, barcode, voucher + share
4. **Categories** — product categories
5. **Stores** — store management
6. **Suppliers** — supplier management + payment tracking; payment edit/delete with balance adjustment; Share Image on voucher
7. **Customers** — customer management + payment history; payment edit/delete with balance adjustment; Share Image on voucher
8. **Stock In** — goods receiving vouchers; share on receipt; negative value validation
9. **Pricing** — cost + margin → selling price; Print + Excel export; carton price column; ETB currency
10. **POS Sales** — point-of-sale; sellByCarton toggle; ETB currency; share on receipt; negative value validation
11. **Order Vouchers** — e-commerce order review/approval; share on receipt; ETB currency
12. **Transfers** — inter-store product transfers; By Carton toggle (stores actual units); carton display on receipt; share on receipt; stock availability check
13. **Damage/Returns** — damage/return recording; share on receipt; ETB currency
14. **Expenses** — expense tracking; share on receipt; ETB currency
15. **Store Balance** — live inventory per store
16. **Bincard** — product movement history
17. **Reports** — financial reports; custom date range (From/To pickers); period options: Today/7D/30D/Year/All/Custom; "Generate Report" button; ETB currency; Excel export
18. **Inventory** — import products/stock from XLSX, export to XLSX, clear collections
19. **Store Requests** — store-to-store transfer requests; pending → approved → received workflow; stock only transfers on "received"; tracks approvedBy + receivedBy; By Carton toggle; professional receipt with share/print
20. **Accounts** — bank account management (Bank Name, Person Name, Account No); deposit/withdraw vouchers with FS Number + photo proof; full transaction history per account; share/print
21. **Promotions** — create promotions with photo, title, description, link; assign featured products; show as header banner, popup, or product highlight cards on e-commerce storefront
22. **Direct Sales** — record direct product sales from store; by carton or piece; sold-by username; stock validation; professional receipt with share/print
23. **Settings** — user settings (name/password change with re-auth); e-commerce settings (logo, store name, tagline, hero text, footer, primary color, font style)
24. **Users** — (admin only) create/edit/delete staff accounts with per-page permissions

#### Firebase Setup
- Project ID: `inventory-new-106c1`
- Config stored as `VITE_FIREBASE_*` environment variables
- Auth must be enabled in Firebase console (Email/Password provider)
- Firestore `users` collection stores user profiles (doc ID = Firebase UID)
- Firestore security rules must allow read/write (test mode or custom rules)

#### Cloudinary Setup
- Cloud name: `dis7rvtue` (VITE_CLOUDINARY_CLOUD_NAME)
- Upload preset: `inventory_upload` — must be **unsigned** in Cloudinary dashboard
- API key stored as VITE_CLOUDINARY_API_KEY (not needed for unsigned uploads)

#### Currency
- All monetary values display as `ETB X.XX` via `fmt(n)` from `src/lib/currency.ts`
- Do NOT use `$` or `.toFixed(2)` directly in JSX — use `{fmt(amount)}` instead

#### Carton Selling
- **POS Sales**: `SaleItem.sellByCarton` toggle; actual qty × qpc deducted from stock
- **Transfers**: `TransferItem.sellByCarton` toggle; "By Carton" column in form; stored as actual units; receipt shows "X ctn (Y pcs)"
- **Ecommerce**: CartItem has `sellByCarton`; product cards show both piece price and carton price; "Add by Piece" and "Add by Carton" buttons (when qpc > 1)

#### Key Files
- `src/lib/firebase.ts` — Firebase app, db, storage, auth
- `src/lib/firestore.ts` — Firestore helpers, COLLECTIONS, createWithId, clearCollection
- `src/lib/auth.tsx` — AuthProvider, useAuth, ALL_PERMISSIONS
- `src/lib/currency.ts` — `fmt(n)` → `ETB ${n.toFixed(2)}`
- `src/lib/share.ts` — shareText() utility (Web Share API → clipboard fallback)
- `src/lib/shareImage.ts` — shareAsImage(element, filename) captures DOM → PNG via html2canvas; uses navigator.share({files}) with download fallback
- `src/lib/types.ts` — all TypeScript types including AppUser; TransferItem.sellByCarton added; createdByName/updatedByName on PosSale, Transfer, DamageReturn, Expense, AccountVoucher, StockIn, DirectSale; isVoided on AccountVoucher
- `src/App.tsx` — routing with ProtectedPage, AdminOnly wrappers
- `src/components/Layout.tsx` — sidebar with permission-filtered nav + logout

### api-server (artifacts/api-server)
Minimal Express API server (currently not actively used by the frontend).
