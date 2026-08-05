import { NAVY, NAVY_LIGHT, GOLD } from '../theme.js';
import logo from '../assets/logo.png';

// Cinematic intro shown while the app boots (settings/enums load, session
// re-validation, etc.) so users see office branding instead of blank white.
// `closing` triggers the fade/scale-out once boot resolves and the minimum
// on-screen time has elapsed (see App.jsx).
export default function SplashScreen({ closing }) {
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
        @keyframes splashFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashRingIn {
          from { opacity: 0; transform: scale(0.82); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes splashGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(201, 162, 39, 0.35); }
          50% { box-shadow: 0 0 0 32px rgba(201, 162, 39, 0); }
        }
      `}</style>

      <div
        style={{
          width: 190,
          height: 190,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid rgba(201, 162, 39, 0.4)`,
          animation: 'splashRingIn 800ms ease both, splashGlow 2600ms ease-in-out 800ms infinite',
        }}
      >
        <img
          src={logo}
          alt="Talisay City Parole and Probation Office seal"
          style={{ width: 124, height: 124, objectFit: 'contain' }}
        />
      </div>

      <div
        style={{
          marginTop: 40,
          textAlign: 'center',
          padding: '0 24px',
          animation: 'splashFadeUp 800ms ease 250ms both',
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 16,
            letterSpacing: 4,
            textTransform: 'uppercase',
            marginBottom: 12,
            opacity: 0.85,
          }}
        >
          Republic of the Philippines
        </div>
        <div
          style={{
            color: '#f4efe0',
            fontSize: 42,
            fontWeight: 600,
            letterSpacing: 0.5,
            lineHeight: 1.3,
          }}
        >
          Talisay City Parole and Probation Office
        </div>
        <div
          style={{
            marginTop: 18,
            color: 'rgba(244,239,224,0.75)',
            fontSize: 22,
            fontStyle: 'italic',
          }}
        >
          Changing Lives, Building a Safer Nation
        </div>
      </div>

      <div
        style={{
          marginTop: 32,
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          justifyContent: 'center',
          padding: '0 24px',
          animation: 'splashFadeUp 800ms ease 550ms both',
        }}
      >
        <span style={{ color: GOLD, fontSize: 16, letterSpacing: 0.3 }}>
          #ChangingLivesBuildingASaferNation
        </span>
        <span style={{ color: 'rgba(201, 162, 39, 0.55)', fontSize: 16 }}>&middot;</span>
        <span style={{ color: GOLD, fontSize: 16, letterSpacing: 0.3 }}>
          #AlagangMayPusoSerbisyongMayIntegridad
        </span>
      </div>
    </div>
  );
}
