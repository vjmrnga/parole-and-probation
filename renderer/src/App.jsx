import { useCallback, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { ApiClient } from './api/apiClient.js';
import { serverEvents } from './api/serverEvents.js';
import { syncOutbox } from './api/offlineAttendance.js';
import { AppContext } from './AppContext.jsx';
import ChooseModeScreen from './screens/ChooseModeScreen.jsx';
import HeadOfficeSetupScreen from './screens/HeadOfficeSetupScreen.jsx';
import BranchOfficeSetupScreen from './screens/BranchOfficeSetupScreen.jsx';
import LoginScreen from './screens/LoginScreen.jsx';
import SettingsView from './screens/SettingsView.jsx';
import AppShell from './screens/AppShell.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import WelcomeEntranceScreen from './components/WelcomeEntranceScreen.jsx';
import ExitAppButton from './components/ExitAppButton.jsx';

// Splash stays up at least this long even if boot resolves instantly, so
// it reads as an intentional cinematic intro rather than a flash.
const SPLASH_MIN_MS = 2200;

// How long the post-login welcome curtain (WelcomeEntranceScreen) stays up
// before it starts fading, and how long that fade takes — mirrors the
// boot-time splash's own timing (SPLASH_MIN_MS + its 700ms fade above).
const WELCOME_HOLD_MS = 2000;
const WELCOME_FADE_MS = 700;

// Views worth restoring after a refresh. caseDetail/settings are excluded —
// caseDetail needs a selectedProbationerId we don't persist, and settings is
// a Ctrl+S overlay rather than a place users expect to land back on.
const RESTORABLE_VIEWS = ['dashboard', 'signatureAttendance', 'manageUsers', 'psir', 'recordsCheck'];
const APP_VIEW_STORAGE_KEY = 'appView';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [splashClosing, setSplashClosing] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [screen, setScreen] = useState('chooseMode'); // chooseMode | hoSetup | boSetup | login | settings | app
  const [hoInitialStep, setHoInitialStep] = useState(0); // 0 = MySQL connection, 1 = create admin
  const [enums, setEnums] = useState({ STAGES: [], STATUSES: [], ROLES: [] });
  const [settings, setSettings] = useState({});
  const [user, setUser] = useState(null);
  const [appView, setAppView] = useState('dashboard'); // dashboard | caseDetail | signatureAttendance | manageUsers | settings
  const [selectedProbationerId, setSelectedProbationerId] = useState(null);
  const [welcomeUser, setWelcomeUser] = useState(null);
  const [welcomeClosing, setWelcomeClosing] = useState(false);
  const [sessionEndedMessage, setSessionEndedMessage] = useState('');
  // Shown when an online session loses its connection to Head Office mid-use.
  const [connectionLostOpen, setConnectionLostOpen] = useState(false);
  // Shown when, while offline, Head Office becomes reachable again.
  const [backOnlineOpen, setBackOnlineOpen] = useState(false);
  // Branch Office signed in against a cached credential because Head Office was
  // unreachable — the app is restricted to attendance until reconnected.
  const [offlineMode, setOfflineMode] = useState(false);

  const refreshSettings = useCallback(async () => {
    const s = await window.api.getSettings();
    setSettings(s);
    return s;
  }, []);

  const openSettings = useCallback(() => {
    // Ctrl+S works pre-login too, so mode selection (Switch Mode…) is reachable
    // from the Sign In screen. Logged in, Settings lives inside the app shell;
    // logged out, it's a standalone screen that returns to Login on "Back".
    if (user) {
      setScreen('app');
      setAppView('settings');
    } else {
      setScreen('settings');
    }
  }, [user]);

  const goDashboard = useCallback(() => {
    setAppView('dashboard');
    setScreen('app');
  }, []);

  const logout = useCallback(() => {
    ApiClient.logout();
    localStorage.removeItem(APP_VIEW_STORAGE_KEY);
    setUser(null);
    setOfflineMode(false);
    setScreen('login');
  }, []);

  const openCase = useCallback((id) => {
    setSelectedProbationerId(id);
    setAppView('caseDetail');
  }, []);

  const enterApp = useCallback((loggedInUser) => {
    setUser(loggedInUser);
    setOfflineMode(false);
    setAppView('dashboard');
    setScreen('app');
    setWelcomeClosing(false);
    setWelcomeUser(loggedInUser);
  }, []);

  // Restricted entry when Head Office is unreachable: attendance is the only
  // view available (see AppShell), and everything routes to it.
  const enterOfflineApp = useCallback((loggedInUser) => {
    setUser(loggedInUser);
    setOfflineMode(true);
    setAppView('signatureAttendance');
    setScreen('app');
    setWelcomeClosing(false);
    setWelcomeUser(loggedInUser);
  }, []);

  // Choose Mode → Head Office always starts the wizard fresh at step 0,
  // regardless of how hoSetup was last left (e.g. from a resumed
  // needsAdmin jump-to-step-1 on a previous boot).
  const goHeadOfficeSetup = useCallback(() => {
    setHoInitialStep(0);
    setScreen('hoSetup');
  }, []);

  useEffect(() => {
    async function boot() {
      const enumsData = await window.api.getEnums();
      setEnums(enumsData);
      const s = await refreshSettings();

      // Fresh install (no mode picked yet): land on Settings, where mode
      // selection now lives (Switch Mode…), rather than a standalone screen.
      if (!s.mode) {
        setScreen('settings');
        setBooting(false);
        return;
      }
      if (s.mode === 'head-office' && (!s.mysqlConfig || !s.mysqlConfig.user)) {
        setHoInitialStep(0);
        setScreen('hoSetup');
        setBooting(false);
        return;
      }
      if (s.mode === 'branch-office' && !s.pinnedCertFingerprint) {
        setScreen('boSetup');
        setBooting(false);
        return;
      }

      // Resume a session carried over from before a page reload — re-validate
      // against the server rather than trusting a possibly-stale token.
      if (ApiClient.isLoggedIn()) {
        try {
          const { user: restoredUser } = await ApiClient.get('/auth/me');
          setUser(restoredUser);
          const savedView = localStorage.getItem(APP_VIEW_STORAGE_KEY);
          const canRestoreManageUsers = savedView !== 'manageUsers' || restoredUser.role === 'admin';
          setAppView(RESTORABLE_VIEWS.includes(savedView) && canRestoreManageUsers ? savedView : 'dashboard');
          setScreen('app');
          setBooting(false);
          return;
        } catch (err) {
          ApiClient.logout();
        }
      }

      if (s.mode === 'head-office') {
        try {
          const status = await ApiClient.get('/auth/bootstrap-status');
          if (status.needsAdmin) {
            setHoInitialStep(1);
            setScreen('hoSetup');
          } else {
            setScreen('login');
          }
        } catch (err) {
          setHoInitialStep(0);
          setScreen('hoSetup');
        }
      } else {
        setScreen('login');
      }
      setBooting(false);
    }

    boot();
  }, [refreshSettings]);

  useEffect(() => {
    if (screen === 'app' && RESTORABLE_VIEWS.includes(appView)) {
      localStorage.setItem(APP_VIEW_STORAGE_KEY, appView);
    }
  }, [screen, appView]);

  // Open the real-time event stream while logged in (see
  // renderer/src/api/serverEvents.js) so screens can auto-refresh when data
  // changes on another machine; tear it down on logout / session end.
  useEffect(() => {
    if (!user || offlineMode) return undefined; // no token / no server in offline mode
    serverEvents.connect(ApiClient.getToken());
    return () => serverEvents.disconnect();
  }, [user, offlineMode]);

  // On a normal (online) login, replay any attendance this officer captured
  // offline earlier. Best-effort and quiet — the attendance screen also offers
  // a manual "Sync now" and shows what's still queued.
  useEffect(() => {
    if (!user || offlineMode) return;
    (async () => {
      try {
        const { entries } = await window.api.offlineGetOutbox();
        if (entries.length) {
          await syncOutbox(user.id);
        }
      } catch (err) {
        // leave the queue for the manual sync path
      }
    })();
  }, [user, offlineMode]);

  useEffect(() => {
    const timer = setTimeout(() => setSplashElapsed(true), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  // Post-login welcome curtain: hold, then fade, then unmount.
  useEffect(() => {
    if (!welcomeUser) return undefined;
    const closeTimer = setTimeout(() => setWelcomeClosing(true), WELCOME_HOLD_MS);
    const hideTimer = setTimeout(() => setWelcomeUser(null), WELCOME_HOLD_MS + WELCOME_FADE_MS);
    return () => {
      clearTimeout(closeTimer);
      clearTimeout(hideTimer);
    };
  }, [welcomeUser]);

  // Single-session enforcement (server/middleware/auth.js): this account
  // signed in elsewhere, which ended the session running here. Bounce back
  // to the login screen and explain why, rather than silently dumping the
  // user out mid-task.
  useEffect(() => {
    ApiClient.onSessionReplaced((message) => {
      setUser(null);
      setWelcomeUser(null);
      localStorage.removeItem(APP_VIEW_STORAGE_KEY);
      setScreen('login');
      setSessionEndedMessage(message);
    });
  }, []);

  // While in offline mode, poll Head Office; once it's reachable again, prompt
  // the user to sign in online so their queued attendance can sync.
  useEffect(() => {
    if (!offlineMode) return undefined;
    let stopped = false;
    const id = setInterval(async () => {
      const res = await window.api.pingHeadOffice();
      if (!stopped && res && res.ok) {
        clearInterval(id);
        setBackOnlineOpen(true);
      }
    }, 15000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [offlineMode]);

  // Mid-session connection loss: an online request couldn't reach Head Office.
  // Tell the user and return them to the login screen, where they can continue
  // in offline attendance mode (see LoginScreen). Ignored if already offline.
  useEffect(() => {
    ApiClient.onConnectionLost(() => {
      if (ApiClient.isOffline()) return;
      // Clear locally without a network logout — the server is unreachable, and
      // a logout request would just re-trigger this handler.
      ApiClient.clearLocalSession();
      setUser(null);
      setOfflineMode(false);
      setWelcomeUser(null);
      localStorage.removeItem(APP_VIEW_STORAGE_KEY);
      setScreen('login');
      setConnectionLostOpen(true);
    });
  }, []);

  useEffect(() => {
    if (booting || !splashElapsed) return undefined;
    setSplashClosing(true);
    const timer = setTimeout(() => setShowSplash(false), 700);
    return () => clearTimeout(timer);
  }, [booting, splashElapsed]);

  // Ctrl+S / Cmd+S opens Settings from anywhere — including pre-login, so mode
  // selection stays reachable now that the Sign In screen has no Back button.
  // No visible menu item or icon, by design (see conversation history on this).
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSettings();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSettings]);

  const ctxValue = {
    enums,
    settings,
    refreshSettings,
    user,
    appView,
    setAppView,
    selectedProbationerId,
    openSettings,
    goDashboard,
    goHeadOfficeSetup,
    logout,
    openCase,
    enterApp,
    enterOfflineApp,
    offlineMode,
    setScreen,
    hoInitialStep,
  };

  return (
    <>
      <ExitAppButton />
      {!booting && (
        <AppContext.Provider value={ctxValue}>
          {screen === 'chooseMode' && <ChooseModeScreen />}
          {screen === 'hoSetup' && <HeadOfficeSetupScreen />}
          {screen === 'boSetup' && <BranchOfficeSetupScreen />}
          {screen === 'login' && <LoginScreen />}
          {screen === 'settings' && (
            <div style={{ padding: 32, minHeight: '100vh' }}>
              <SettingsView />
            </div>
          )}
          {screen === 'app' && <AppShell />}
        </AppContext.Provider>
      )}
      {showSplash && <SplashScreen closing={splashClosing} />}
      {welcomeUser && <WelcomeEntranceScreen user={welcomeUser} closing={welcomeClosing} />}
      <Modal
        open={!!sessionEndedMessage}
        title="Signed out"
        okText="OK"
        cancelButtonProps={{ style: { display: 'none' } }}
        closable={false}
        maskClosable={false}
        onOk={() => setSessionEndedMessage('')}
      >
        {sessionEndedMessage}
      </Modal>
      <Modal
        open={connectionLostOpen}
        title="You are now offline"
        okText="OK"
        cancelButtonProps={{ style: { display: 'none' } }}
        closable={false}
        maskClosable={false}
        onOk={() => setConnectionLostOpen(false)}
      >
        Head Office can&apos;t be reached, so you&apos;ve been returned to the login screen. Sign in again to
        reconnect, or choose <strong>Continue in Offline Mode</strong> to log attendance offline.
      </Modal>
      <Modal
        open={backOnlineOpen}
        title="You're back online"
        okText="Sign in to sync"
        cancelText="Later"
        maskClosable={false}
        onOk={() => {
          setBackOnlineOpen(false);
          logout();
        }}
        onCancel={() => setBackOnlineOpen(false)}
      >
        The connection to Head Office has been restored. Sign in again to reconnect — the attendance you
        logged offline will sync automatically once you do.
      </Modal>
    </>
  );
}
