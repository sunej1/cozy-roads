export const VEHICLES = {
  wagon: {
    name: 'Wayfarer',
    description: 'Family wagon · Progressive throttle and a steady ride on gravel.',
    topSpeed: 28, pull: 5.3, turn: 1.52, roughGrip: 0.78, climb: 0.66, ford: 0.38,
    radius: 0.298, width: 1.88, wheelbase: 2.58, suspension: 0.49,
  },
  retro: {
    name: 'Redline 92',
    description: 'Retro sports coupe · Quick turn-in and lively acceleration on pavement.',
    topSpeed: 40, pull: 8.0, turn: 1.84, roughGrip: 0.60, climb: 0.51, ford: 0.25,
    radius: 0.327, width: 1.88, wheelbase: 2.62, suspension: 0.31,
  },
  hyper: {
    name: 'Vela',
    description: 'Hypercar · Strongest pull on pavement and sensitive to rough ground.',
    topSpeed: 54, pull: 13.4, turn: 1.65, roughGrip: 0.43, climb: 0.39, ford: 0.16,
    radius: 0.338, width: 2.02, wheelbase: 2.76, suspension: 0.24,
  },
  '930': {
    name: 'Porsche 911 Turbo (930)',
    description: 'Whale-tail 911 · Short wheelbase and a lively rear on loose ground.',
    topSpeed: 46, pull: 8.7, turn: 1.88, roughGrip: 0.58, climb: 0.48, ford: 0.22,
    radius: 0.307, width: 1.79, wheelbase: 2.27, suspension: 0.33,
  },
  gt3rs: {
    name: 'Porsche 911 GT3 RS',
    description: 'Track-focused 911 · Quick acceleration, precise steering and low clearance.',
    topSpeed: 53, pull: 12.6, turn: 1.99, roughGrip: 0.47, climb: 0.41, ford: 0.17,
    radius: 0.347, width: 1.99, wheelbase: 2.46, suspension: 0.25,
  },
  trail: {
    name: 'Ridgeline 4×4',
    description: 'Off-roader · Keeps its grip on steep trails and can ford shallower water.',
    topSpeed: 25, pull: 6.4, turn: 1.33, roughGrip: 1.02, climb: 0.94, ford: 0.78,
    radius: 0.379, width: 1.86, wheelbase: 2.46, suspension: 0.72,
  },
};

export function vehicleId(value) {
  return Object.hasOwn(VEHICLES, value) ? value : 'wagon';
}
