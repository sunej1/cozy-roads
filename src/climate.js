export const seasons = {
  spring: { meadow: '#b6df9c', foliage: '#b6f699', grass: '#c9e7ae', winter: 0 },
  summer: { meadow: '#b6c995', foliage: '#83bc75', grass: '#b4d08b', winter: 0 },
  autumn: { meadow: '#ffffff', foliage: '#ffffff', grass: '#ffffff', winter: 0 },
  winter: { meadow: '#c9d4dd', foliage: '#adc2c4', grass: '#adb5a8', winter: 1 },
};

export const daylight = {
  dawn: { direction: [0.92, 0.2, 0.32], sun: '#ffa67f', sky: '#efb2ad', air: '#e5c0c6', power: 2.65, ambient: 0.78 },
  day: { direction: [-0.84, 0.51, -0.43], sun: '#ffdfb0', sky: '#ffffff', air: '#ffffff', power: 4.45, ambient: 1 },
  dusk: {
    direction: [-0.95, 0.115, 0.19],
    sun: '#ff875b',
    sky: '#ed9b89',
    air: '#d5a1b3',
    power: 2.15,
    ambient: 0.64,
  },
  night: {
    direction: [0.76, 0.48, -0.25],
    sun: '#a5c9ff',
    sky: '#2c3b58',
    air: '#283852',
    power: 0.32,
    ambient: 0.29,
  },
};
