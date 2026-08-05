import { Button, Modal } from 'antd';

// Fixed to the top-right corner of the viewport so it stays visible across
// every screen (choose-mode, setup wizards, login, and the app shell alike)
// rather than living inside any one screen's own layout.
export default function ExitAppButton() {
  const confirmExit = () => {
    Modal.confirm({
      title: 'Exit app?',
      content: 'Are you sure you want to close the application?',
      okText: 'Exit',
      cancelText: 'Cancel',
      onOk: () => window.api.quitApp(),
    });
  };

  return (
    <Button
      danger
      onClick={confirmExit}
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 999 }}
    >
      Exit App
    </Button>
  );
}
