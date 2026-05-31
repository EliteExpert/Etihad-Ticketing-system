export const boardingPassApiUrl =
  process.env.BOARDING_PASS_API_URL ?? 'https://etihad-ticketing-system-backend.onrender.com/generate-boarding-pass';

export const BUSINESS_ROLE_ID = '1499998210163478609';
export const FIRST_ROLE_ID = '1499998296209625258';
export const SUPPORT_REQUESTS_CHANNEL_ID = '1503282404146548878';
export const SUPPORT_PING_ROLE_ID = '1499607934844403842';
export const FLIGHT_PING_ROLE_ID = '1503399633936715906';
export const FLIGHT_MANAGER_ROLE_ID = '1503457047545512147';

export const FLIGHT_COLOR = 0x1c2a33;
export const MILES_EMOJI = '<:miles:1503446324471926824>';
export const ETIHAD_TAIL_EMOJI = '<:EtihadTail:1500012291188461660>';
export const FOOTER_IMAGE_URL =
  'https://media.discordapp.net/attachments/1504449130603216906/1508816599958687884/Flights_footer.png?ex=6a16ea75&is=6a1598f5&hm=299ded682b918936d97724767054469b03f08e2c737dbd8bbb140e2af0726a4d&=&format=webp&quality=lossless';

export const SUPPORT_COLORS = {
  unclaimed: 0x808080,
  inProgress: 0xffcc00,
  closed: 0x2ecc71,
  relay: 0xffcc00
};

export const SHOP_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;

export const SHOP_ITEMS = {
  class_upgrade: {
    label: 'Class upgrade voucher',
    price: 900,
    description: 'Use this as a staff-approved upgrade request on a future flight.'
  },
  lounge_pass: {
    label: 'Lounge access pass',
    price: 450,
    description: 'Redeem for lounge access before one eligible flight.'
  },
  priority_boarding: {
    label: 'Priority boarding pass',
    price: 300,
    description: 'Redeem for priority boarding on one eligible flight.'
  },
  skywards_badge: {
    label: 'Skywards profile badge',
    price: 150,
    description: 'A low-cost cosmetic reward for frequent flyers.'
  }
};

export const GUEST_TIERS = {
  bronze: {
    label: 'Bronze',
    roleId: '1510676949276688555',
    price: 0,
    benefits: ['Etihad Guest account access', 'Earn and redeem Etihad miles']
  },
  silver: {
    label: 'Silver',
    roleId: '1510677098262564864',
    price: 1500,
    benefits: ['Priority check-in recognition', 'Silver member profile status']
  },
  gold: {
    label: 'Gold',
    roleId: '1510677169125195936',
    price: 3500,
    benefits: ['Priority boarding recognition', 'Gold member profile status']
  },
  platinum: {
    label: 'Platinum',
    roleId: '1510677230370422844',
    price: 7000,
    benefits: ['Premium support recognition', 'Platinum member profile status']
  },
  emerald: {
    label: 'Emerald',
    roleId: '1510677294799126740',
    price: 12000,
    benefits: ['Highest Etihad Guest recognition', 'Emerald member profile status']
  }
};

export const GUEST_TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'emerald'];
