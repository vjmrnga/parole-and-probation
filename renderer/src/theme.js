// Palette pulled from the Parole and Probation Administration seal:
// deep navy field, gold ring/text/scales.
export const NAVY = '#16233f';
export const NAVY_LIGHT = '#24355c';
export const GOLD = '#c9a227';
export const GOLD_DARK = '#a3801d';

export const antdTheme = {
  token: {
    colorPrimary: GOLD,
    colorLink: NAVY,
    colorLinkHover: GOLD_DARK,
    borderRadius: 6,
  },
  components: {
    Layout: {
      siderBg: NAVY,
      headerBg: NAVY,
    },
    Menu: {
      darkItemBg: NAVY,
      darkItemSelectedBg: GOLD,
      darkItemSelectedColor: NAVY,
      darkItemHoverBg: NAVY_LIGHT,
      darkItemColor: '#b7bfd4',
    },
    Button: {
      colorPrimary: GOLD,
      colorPrimaryHover: GOLD_DARK,
      primaryColor: NAVY,
    },
    Table: {
      headerBg: NAVY,
      headerColor: '#fff',
      headerSortActiveBg: NAVY_LIGHT,
    },
  },
};
