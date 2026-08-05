// Head Office mode keeps its API server + backup scheduler running even when
// the window is closed, so it survives as a tray icon; only the tray's
// "Quit" truly exits the app.
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;

function create(mainWindow, { onQuit }) {
  if (tray) return tray;

  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Parole and Probation Case Manager (Head Office)');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { create, destroy };
