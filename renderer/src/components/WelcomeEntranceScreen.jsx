import { NAVY, NAVY_LIGHT, GOLD } from '../theme.js';
import logo from '../assets/logo.png';

function greetingForHour(hour) {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstNameOf(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0];
}

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

// Cinematic curtain shown for a couple seconds right after a successful
// login, over the top of the freshly-mounted AppShell — same navy/gold
// language and animation pattern as SplashScreen.jsx (the boot-time splash),
// but personalized to the user who just signed in. `closing` triggers the
// fade/scale-out; see App.jsx for the timing.
export default function WelcomeEntranceScreen({ user, closing }) {
  const greeting = greetingForHour(new Date().getHours());
  const name = firstNameOf(user?.full_name) || user?.username || '';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `radial-gradient(circle at 50% 40%, ${NAVY_LIGHT} 0%, ${NAVY} 65%, #0c1526 100%)`,
        opacity: closing ? 0 : 1,
        transform: closing ? 'scale(1.03)' : 'scale(1)',
        transition: 'opacity 700ms ease, transform 700ms ease',
        pointerEvents: closing ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes welcomeFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes welcomeRingIn {
          from { opacity: 0; transform: scale(0.82); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes welcomeGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(201, 162, 39, 0.35); }
          50% { box-shadow: 0 0 0 32px rgba(201, 162, 39, 0); }
        }
      `}</style>

      <div
        style={{
          width: 150,
          height: 150,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid rgba(201, 162, 39, 0.4)`,
          animation: 'welcomeRingIn 800ms ease both, welcomeGlow 2600ms ease-in-out 800ms infinite',
        }}
      >
        <img src={logo} alt="" style={{ width: 96, height: 96, objectFit: 'contain' }} />
      </div>

      <div style={{ marginTop: 36, textAlign: 'center', padding: '0 24px', animation: 'welcomeFadeUp 800ms ease 250ms both' }}>
        <div style={{ color: GOLD, fontSize: 16, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12, opacity: 0.85 }}>
          {greeting}
        </div>
        <div style={{ color: '#f4efe0', fontSize: 44, fontWeight: 600, letterSpacing: 0.5, lineHeight: 1.25 }}>
          Welcome, {name}
        </div>
        <div style={{ marginTop: 18, color: 'rgba(244,239,224,0.75)', fontSize: 20, fontStyle: 'italic' }}>
          It&rsquo;s time for a new day.
        </div>
      </div>

      <div style={{ marginTop: 32, color: 'rgba(201, 162, 39, 0.75)', fontSize: 15, letterSpacing: 0.3, animation: 'welcomeFadeUp 800ms ease 550ms both' }}>
        {TODAY_LABEL}
      </div>
    </div>
  );
}
