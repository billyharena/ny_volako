import { ArrowUpRight, Check, Circle, Compass, Layers3, Settings2, Wallet } from 'lucide-react'
import { NavLink, Route, Routes, Link } from 'react-router'
import { readEnvironment } from '../config/environment'

const environment = readEnvironment(import.meta.env)

export function App() {
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main">Aller au contenu</a>
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="Ny Volako, accueil">
          <span className="brand-icon shrink-0"><Wallet size={23} aria-hidden="true" /></span>
          <span>ny volako<span className="brand-caption">MON CARNET DE DÉPENSES</span></span>
        </Link>
        <p className="nav-heading">VOTRE ESPACE</p>
        <nav aria-label="Navigation principale">
          <NavLink to="/" end><Compass size={20} aria-hidden="true" />Accueil</NavLink>
          <NavLink to="/configuration"><Settings2 size={20} aria-hidden="true" />Configuration</NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="small-dot" />Un projet qui prend forme
          <p>Des bases solides pour vos dépenses du quotidien.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Espace personnel</span>
          <span className="phase-badge"><span className="small-dot" />Version de développement</span>
        </header>
        <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/configuration" element={<Configuration />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
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
        <p>Votre futur carnet pour suivre vos dépenses et avancer à votre rythme.</p>
      </div>
      <section className="hero-card" aria-labelledby="hero-title">
        <div className="hero-content">
          <span className="pill"><Layers3 size={15} aria-hidden="true" />Les fondations</span>
          <h2 id="hero-title">Votre espace<br />se prépare.</h2>
          <p>Ny Volako se construit étape par étape. Le socle est en place ; la connexion à votre compte sera la prochaine étape.</p>
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
        <div className="section-heading"><h2 id="steps-title">La suite, simplement</h2><span>Étape 2 sur 7</span></div>
        <div className="step-grid">
          <Step number="01" title="Poser les bases" text="L’architecture est validée. L’application et ses outils de vérification sont initialisés." current />
          <Step number="02" title="Connecter votre compte" text="Une connexion personnelle et des accès protégés à vos données." />
          <Step number="03" title="Suivre votre quotidien" text="Dépenses, budgets et consultation hors ligne viendront aux prochaines étapes." />
        </div>
      </section>
      <p className="development-note">Cette version ne permet pas encore de saisir des dépenses. Aucune donnée financière n’est affichée ou enregistrée.</p>
    </>
  )
}

function Step({ number, title, text, current = false }: { number: string; title: string; text: string; current?: boolean }) {
  return (
    <article className="step-card">
      <div className="step-top"><span>{number}</span>{current ? <Check size={18} aria-label="Socle initialisé" /> : <Circle size={15} aria-label="À venir" />}</div>
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
        <p>La connexion et la synchronisation ne sont pas encore activées dans cette version.</p>
        <dl className="settings-list">
          <div><dt>Langue de l’interface</dt><dd>Français</dd></div>
          <div><dt>Devise prévue par défaut</dt><dd>Ariary · MGA</dd></div>
          <div><dt>État du projet</dt><dd>Initialisation · Phase 2</dd></div>
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
