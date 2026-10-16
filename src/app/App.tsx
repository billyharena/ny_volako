import { ArrowUpRight, Check, Circle, Compass, Layers3, Settings2, Wallet } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes, Link } from 'react-router'
import { readEnvironment } from '../config/environment'
import { useAuth } from '../features/auth/context'
import { PwaControls, UpdateNotice } from '../pwa/PwaControls'
import { RouteFocus } from './RouteFocus'

const AccountPage = lazy(() => import('../features/auth/AccountPage').then(module => ({ default: module.AccountPage })))
const AuthPage = lazy(() => import('../features/auth/AuthPage').then(module => ({ default: module.AuthPage })))
const PrivateWorkspace = lazy(() => import('../features/finance/PrivateWorkspace').then(module => ({ default: module.PrivateWorkspace })))
const Dashboard = lazy(() => import('../features/finance/Dashboard').then(module => ({ default: module.Dashboard })))
const ExpenseEditor = lazy(() => import('../features/finance/Expenses').then(module => ({ default: module.ExpenseEditor })))
const ExpenseHistory = lazy(() => import('../features/finance/Expenses').then(module => ({ default: module.ExpenseHistory })))
const ExpenseImport = lazy(() => import('../features/finance/ExpenseImport').then(module => ({ default: module.ExpenseImport })))
const Categories = lazy(() => import('../features/finance/Categories').then(module => ({ default: module.Categories })))
const Budgets = lazy(() => import('../features/finance/Budgets').then(module => ({ default: module.Budgets })))
const Synchronization = lazy(() => import('../features/finance/Synchronization').then(module => ({ default: module.Synchronization })))

const environment = readEnvironment(import.meta.env)

export function App() {
  const { session } = useAuth()
  return (
    <div className="app-layout">
      <RouteFocus />
      <a className="skip-link" href="#main">Aller au contenu</a>
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="Ny Volako, accueil">
          <span className="brand-icon shrink-0"><Wallet size={23} aria-hidden="true" /></span>
          <span>ny volako<span className="brand-caption">MON CARNET DE DÉPENSES</span></span>
        </Link>
        <p className="nav-heading">VOTRE ESPACE</p>
        <nav aria-label="Navigation principale">
          <NavLink to={session ? '/tableau-de-bord' : '/'} end><Compass size={20} aria-hidden="true" />Accueil</NavLink>
          {session ? <><NavLink to="/depenses"><Layers3 size={20} aria-hidden="true" />Dépenses</NavLink><NavLink to="/budgets"><Settings2 size={20} aria-hidden="true" />Budget</NavLink></> : <NavLink to="/configuration"><Settings2 size={20} aria-hidden="true" />Configuration</NavLink>}
          <NavLink to="/compte"><Wallet size={20} aria-hidden="true" />Mon compte</NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="small-dot" />Votre carnet au quotidien
          <p>Vos dépenses et votre budget, à portée de main.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Espace personnel</span>
          <span className="phase-badge"><span className="small-dot" />Mon carnet de dépenses</span>
        </header>
        <main id="main" tabIndex={-1}>
          <UpdateNotice />
          <Suspense fallback={<p role="status">Ouverture de la page…</p>}>
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/configuration" element={<Configuration />} />
            <Route path="/connexion" element={<AuthPage key="login" mode="login" />} />
            <Route path="/inscription" element={<AuthPage key="register" mode="register" />} />
            <Route path="/mot-de-passe-oublie" element={<AuthPage key="reset" mode="reset" />} />
            <Route path="/recuperation" element={<AuthPage key="recover" mode="recover" />} />
            <Route element={<PrivateWorkspace />}>
              <Route path="/compte" element={<AccountPage />} />
              <Route path="/tableau-de-bord" element={<Dashboard />} />
              <Route path="/depenses" element={<ExpenseHistory />} />
              <Route path="/depenses/nouvelle" element={<ExpenseEditor />} />
              <Route path="/depenses/importer" element={<ExpenseImport />} />
              <Route path="/depenses/:id" element={<ExpenseEditor />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/synchronisation" element={<Synchronization />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          <PwaControls />
        </main>
        <footer>Ny Volako <span>Simple aujourd’hui. Utile au quotidien.</span></footer>
      </div>
    </div>
  )
}

function Welcome() {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">BIENVENUE CHEZ VOUS</p>
        <h1>Un peu plus de clarté,<br />chaque jour.</h1>
        <p>Votre carnet pour suivre vos dépenses et avancer à votre rythme.</p>
      </div>
      <section className="hero-card" aria-labelledby="hero-title">
        <div className="hero-content">
          <span className="pill"><Layers3 size={15} aria-hidden="true" />Votre carnet local</span>
          <h2 id="hero-title">Vos dépenses,<br />l’esprit plus léger.</h2>
          <p>Enregistrez vos achats, retrouvez votre historique et gardez un œil sur votre budget. Vos saisies sont conservées sur cet appareil puis synchronisées avec votre compte.</p>
          <Link to="/compte" className="primary-link">Ouvrir mon compte<ArrowUpRight size={18} aria-hidden="true" /></Link>
          <Link to="/configuration" className="primary-link">Voir la configuration<ArrowUpRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="paper-card">
            <span className="paper-icon"><Wallet size={29} /></span>
            <span className="paper-title">À chaque dépense,<br />un esprit plus léger.</span>
            <div className="paper-line" /><div className="paper-line short" />
            <span className="paper-check"><Check size={17} />Un pas à la fois</span>
          </div>
          <span className="art-spark">✳</span>
        </div>
      </section>
      <section className="progress-section" aria-labelledby="steps-title">
        <div className="section-heading"><h2 id="steps-title">Votre quotidien, simplement</h2><span>Trois repères</span></div>
        <div className="step-grid">
          <Step number="01" title="Saisir vos dépenses" text="Enregistrez vos achats sur cet appareil, même sans réseau après une première connexion." current />
          <Step number="02" title="Connecter votre compte" text="Une connexion personnelle et des accès protégés à vos données." current />
          <Step number="03" title="Suivre votre quotidien" text="Dépenses, catégories et budgets sont disponibles sur cet appareil. Les changements se synchronisent lorsque le réseau est disponible." current />
        </div>
      </section>
      <p className="development-note">Les dépenses sont enregistrées sur votre appareil. Les échanges reprennent au retour du réseau ; les conflits restent soumis à votre choix.</p>
    </>
  )
}

function Step({ number, title, text, current = false }: { number: string; title: string; text: string; current?: boolean }) {
  return (
    <article className="step-card">
      <div className="step-top"><span>{number}</span>{current ? <Check size={18} aria-label="Disponible" /> : <Circle size={15} aria-label="À venir" />}</div>
      <h3>{title}</h3><p>{text}</p>
    </article>
  )
}

function Configuration() {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">LES PREMIERS REPÈRES</p>
        <h1>Configuration</h1>
        <p>L’état de préparation de votre espace.</p>
      </div>
      <section className="settings-card" aria-labelledby="connection-title">
        <span className="setting-icon"><Settings2 size={24} aria-hidden="true" /></span>
        <h2 id="connection-title">Connexion au compte</h2>
        <p role="status">{environment.message}</p>
        <p>La connexion nécessite un serveur Supabase configuré. Les saisies locales sont synchronisées lorsque votre session et le réseau le permettent.</p>
        <dl className="settings-list">
          <div><dt>Langue de l’interface</dt><dd>Français</dd></div>
          <div><dt>Devise par défaut</dt><dd>Ariary · MGA</dd></div>
          <div><dt>Application</dt><dd>Installable sur les navigateurs compatibles</dd></div>
        </dl>
      </section>
    </>
  )
}

function NotFound() {
  return (
    <div className="page-heading">
      <p className="eyebrow">PAGE INTROUVABLE</p>
      <h1>Reprenons par l’accueil.</h1>
      <p>Cette page n’existe pas ou n’est pas encore disponible.</p>
      <Link className="primary-link" to="/">Retour à l’accueil<ArrowUpRight size={18} aria-hidden="true" /></Link>
    </div>
  )
}
