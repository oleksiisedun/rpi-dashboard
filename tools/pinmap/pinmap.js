'use strict';
require('dotenv').config();

/** @typedef {{ physical: number, bcm: number|null, label: string, type: 'power'|'gnd'|'gpio'|'reserved' }} PinDef */

/** @type {PinDef[]} */
const PINS = [
  { physical:  1, bcm: null, label: '3.3V',         type: 'power'    },
  { physical:  2, bcm: null, label: '5V',            type: 'power'    },
  { physical:  3, bcm:  2,   label: 'GPIO2/SDA1',   type: 'gpio'     },
  { physical:  4, bcm: null, label: '5V',            type: 'power'    },
  { physical:  5, bcm:  3,   label: 'GPIO3/SCL1',   type: 'gpio'     },
  { physical:  6, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical:  7, bcm:  4,   label: 'GPIO4/GPCLK0', type: 'gpio'     },
  { physical:  8, bcm: 14,   label: 'GPIO14/TXD',   type: 'gpio'     },
  { physical:  9, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 10, bcm: 15,   label: 'GPIO15/RXD',   type: 'gpio'     },
  { physical: 11, bcm: 17,   label: 'GPIO17',        type: 'gpio'     },
  { physical: 12, bcm: 18,   label: 'GPIO18/PWM0',  type: 'gpio'     },
  { physical: 13, bcm: 27,   label: 'GPIO27',        type: 'gpio'     },
  { physical: 14, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 15, bcm: 22,   label: 'GPIO22',        type: 'gpio'     },
  { physical: 16, bcm: 23,   label: 'GPIO23',        type: 'gpio'     },
  { physical: 17, bcm: null, label: '3.3V',          type: 'power'    },
  { physical: 18, bcm: 24,   label: 'GPIO24',        type: 'gpio'     },
  { physical: 19, bcm: 10,   label: 'GPIO10/MOSI',  type: 'gpio'     },
  { physical: 20, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 21, bcm:  9,   label: 'GPIO9/MISO',   type: 'gpio'     },
  { physical: 22, bcm: 25,   label: 'GPIO25',        type: 'gpio'     },
  { physical: 23, bcm: 11,   label: 'GPIO11/SCLK',  type: 'gpio'     },
  { physical: 24, bcm:  8,   label: 'GPIO8/CE0',    type: 'gpio'     },
  { physical: 25, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 26, bcm:  7,   label: 'GPIO7/CE1',    type: 'gpio'     },
  { physical: 27, bcm:  0,   label: 'ID_SD',         type: 'reserved' },
  { physical: 28, bcm:  1,   label: 'ID_SC',         type: 'reserved' },
  { physical: 29, bcm:  5,   label: 'GPIO5',         type: 'gpio'     },
  { physical: 30, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 31, bcm:  6,   label: 'GPIO6',         type: 'gpio'     },
  { physical: 32, bcm: 12,   label: 'GPIO12/PWM0',  type: 'gpio'     },
  { physical: 33, bcm: 13,   label: 'GPIO13/PWM1',  type: 'gpio'     },
  { physical: 34, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 35, bcm: 19,   label: 'GPIO19/MISO1', type: 'gpio'     },
  { physical: 36, bcm: 16,   label: 'GPIO16/CE2-1', type: 'gpio'     },
  { physical: 37, bcm: 26,   label: 'GPIO26',        type: 'gpio'     },
  { physical: 38, bcm: 20,   label: 'GPIO20/MOSI1', type: 'gpio'     },
  { physical: 39, bcm: null, label: 'GND',           type: 'gnd'      },
  { physical: 40, bcm: 21,   label: 'GPIO21/SCLK1', type: 'gpio'     },
];

/**
 * Builds a map of physical pin → device name from the current .env config.
 * @returns {{ [physicalPin: number]: string }}
 */
function buildUsedPins() {
  const used = {};

  const stb = Number(process.env.TM1638_STB_PIN);
  const clk = Number(process.env.TM1638_CLK_PIN);
  const dio = Number(process.env.TM1638_DIO_PIN);
  if (stb) used[stb] = 'TM1638';
  if (clk) used[clk] = 'TM1638';
  if (dio) used[dio] = 'TM1638';

  // MAX7219 uses SPI0 MOSI (pin 19) + SCLK (pin 23) + CE based on DISPLAY_SPI_DEVICE
  const spiDevice = Number(process.env.DISPLAY_SPI_DEVICE ?? 0);
  used[19] = 'MAX7219';
  used[23] = 'MAX7219';
  used[spiDevice === 1 ? 26 : 24] = 'MAX7219'; // CE1 (GPIO7) or CE0 (GPIO8)

  return used;
}

/**
 * Returns the display label for a pin, appending a device tag when in use.
 * @param {PinDef} pin
 * @param {{ [physicalPin: number]: string }} usedPins
 * @returns {string}
 */
function pinLabel(pin, usedPins) {
  const device = usedPins[pin.physical];
  return device ? `${pin.label} <${device}` : pin.label;
}

/**
 * Prints the RPi 3B 40-pin map and lists free GPIO pins.
 * @returns {void}
 */
function run() {
  const usedPins = buildUsedPins();
  const pinByPhysical = Object.fromEntries(PINS.map(p => [p.physical, p]));

  const COL = 22;
  const DIVIDER = '─'.repeat(56);

  console.log('\nRPi 3B GPIO Map  (from .env)');
  console.log(DIVIDER);

  for (let left = 1; left <= 39; left += 2) {
    const L = pinByPhysical[left];
    const R = pinByPhysical[left + 1];
    const lContent = pinLabel(L, usedPins).padEnd(COL);
    const rContent = pinLabel(R, usedPins).padEnd(COL);
    const ln = String(L.physical).padStart(2);
    const rn = String(R.physical).padStart(2);
    console.log(`${ln}  ${lContent}●●  ${rContent}  ${rn}`);
  }

  console.log(DIVIDER);

  const freeBCM = PINS
    .filter(p => p.type === 'gpio' && !usedPins[p.physical])
    .map(p => p.bcm)
    .sort((a, b) => a - b);

  console.log(`\nFREE GPIO (BCM): ${freeBCM.join(', ')}`);

  const deviceNames = [...new Set(Object.values(usedPins))];
  console.log('\nIn use:');
  for (const device of deviceNames) {
    const devicePins = PINS.filter(p => usedPins[p.physical] === device);
    const bcmList = devicePins.filter(p => p.bcm !== null).map(p => `GPIO${p.bcm}`).join(', ');
    const physList = devicePins.map(p => `pin ${p.physical}`).join(', ');
    console.log(`  ${device}: ${bcmList}  (${physList})`);
  }
  console.log('');
}

run();
