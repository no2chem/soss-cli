#!/usr/bin/env node

import * as soss from 'soss';
import * as commander from 'commander';
import * as table from 'table';
import * as ora from 'ora';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as geolib from 'geolib';
import * as geocoder from 'node-geocoder';
import geocontext from 'geocontext';

import {getStationStaticDetails, Station, StationStaticDetail, StationStatus} from 'soss';
import PositionAsDecimal = geolib.PositionAsDecimal;

const packagejson = require('root-require')('package.json');

commander
    .description('California Hydrogen Station Operational Status System CLI')
    .version(packagejson.version);

export const DATA_FILE = 'soss.json';
export const DATA_FILE_PATH = path.join(__dirname, DATA_FILE);

const spinnerTask = async<T>(task: Promise<T>, text: string): Promise<T> => {
  const spinner = ora(text).start();
  try {
    const retVal: T = await task;
    spinner.succeed();
    return retVal;
  } catch (e) {
    spinner.fail();
    throw e;
  }
};

const statusToString = (status: StationStatus): string => {
  switch (status) {
    case StationStatus.ONLINE:
      return '✅';
    case StationStatus.OFFLINE:
      return '❌';
    case StationStatus.LIMITED:
      return '⚠️';
    case StationStatus.UNKNOWN:
    default:
      return '❓';
  }
};

const dateToString = (date: Date): string => {
  const now = new Date();
  if (now.getFullYear() === date.getFullYear() &&
      now.getMonth() === date.getMonth() && now.getDay() === date.getDay()) {
    return date.toLocaleTimeString();
  }
  return date.toLocaleDateString();
};

const getStaticDetails =
    async(idList: string[]): Promise<{[key: string]: StationStaticDetail}> => {
  const outData: {[key: string]: StationStaticDetail} = {};
  const requestPromises: Array<Promise<void>> = [];
  for (const id of idList) {
    if (id !== undefined && id !== '') {
      requestPromises.push(getStationStaticDetails(id).then(detail => {
        outData[id] = detail;
        return;
      }));
    }
  }
  await Promise.all(requestPromises);
  return outData;
};

const downloadStationData = async () => {
  const status = await spinnerTask(soss.getStatus(), 'Getting Station IDs');
  const ids = status.map(s => s.id);
  const details =
      await spinnerTask(getStaticDetails(ids), 'Getting station data');
  await spinnerTask(
      fs.writeFile(DATA_FILE_PATH, JSON.stringify(details, null, 2)),
      `Write file ${DATA_FILE_PATH}`);
};

const getData = async(): Promise<{[key: string]: StationStaticDetail}> => {
  try {
    const data = await fs.readFile(DATA_FILE_PATH, 'utf8');
    const parsed = JSON.parse(data) as {[key: string]: StationStaticDetail};
    if (Object.keys(parsed).length < 1) {
      throw new Error('No data in saved file!');
    }
    return parsed;
  } catch {
    await downloadStationData();
    const data = await fs.readFile(DATA_FILE_PATH, 'utf8');
    const parsed = JSON.parse(data) as {[key: string]: StationStaticDetail};
    if (Object.keys(parsed).length < 1) {
      throw new Error('No data in saved file!');
    }
    return parsed;
  }
};

const stationToTableArray = (station: Station): Array<string|undefined> => {
  return [
    station.id, station.name, statusToString(station.status35),
    statusToString(station.status70), dateToString(station.updated),
    station.message
  ];
};

commander.command('status [name...]').action(async (name) => {
  if (Array.isArray(name)) {
    name = name.join(' ');
  }
  const status = await spinnerTask(soss.getStatus(), 'Getting Station Status');
  const headings =
      ['🆔  ID', '🏢  Name', 'H35', 'H70', '🕒  Updated', '💬  Message'];
  let result: Array<Array<string|undefined>> = [];
  if (name === '') {
    const mapped = status.map(stationToTableArray);
    result = mapped;
  } else {
    const data = await spinnerTask(getData(), 'Getting station data');
    const stationStatic = Object.entries(data).find(
        entry => entry[0] === name ||
            entry[1].city.toLowerCase() === name.toLowerCase() ||
            entry[1].city.toLowerCase().startsWith(name.toLowerCase()) ||
            entry[1].city.toLowerCase().endsWith(name.toLowerCase()));
    if (stationStatic !== undefined) {
      const station = status.find(s => s.id === stationStatic[0]);
      if (station !== undefined) {
        result.push(stationToTableArray(station));
      }
    }
  }
  result.unshift(headings);
  console.log(table.table(result, {columns: {5: {width: 30}}}));
});

commander.command('nearest [location...]')
    .option('-s --stations <n>', 'Number of stations to return [5]', Number, 5)
    .action(async (loc, args) => {
      let latlong: PositionAsDecimal;
      if (loc === undefined) {
        const location = await spinnerTask(
            geocontext().getCurrentPositionPromise(),
            'Getting current location');
        latlong = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        } as PositionAsDecimal;
      } else {
        if (Array.isArray(loc)) {
          loc = loc.join(' ');
        }
        const result = await geocoder({provider: 'openstreetmap'}).geocode(loc);
        if (result === undefined || result[0] === undefined) {
          throw new Error(`Couldn't find location ${loc}`);
        }
        latlong = {
          latitude: result[0].latitude as number,
          longitude: result[0].longitude as number
        };
      }
      const data = await spinnerTask(getData(), 'Getting station data');
      const status =
          await spinnerTask(soss.getStatus(), 'Getting Station Status');

      const dataAsLatLong = Object.entries(data).map((e) => {
        return {id: e[0], latitude: e[1].latitude, longitude: e[1].longitude};
      });

      const distance = geolib.orderByDistance(latlong, dataAsLatLong);
      const max = args.stations;
      const mapped = [
        ['🚗  Distance', '🏢  Name', 'H35', 'H70', '🕒  Updated', '💬  Message']
      ];
      for (let i = 0; i < max; i++) {
        const distanceItem = distance[i];
        const stationId = dataAsLatLong[Number(distanceItem.key)].id;
        const statusItem = status.find(i => i.id === stationId);
        if (statusItem === undefined) {
          throw new Error(`Unknown station ${stationId}`);
        }
        mapped.push([
          `${
              Number(geolib.convertUnit('mi', distanceItem.distance))
                  .toFixed(2)} mi`,
          statusItem.name, statusToString(statusItem.status35),
          statusToString(statusItem.status70), dateToString(statusItem.updated),
          statusItem.message as string
        ]);
      }
      console.log(table.table(mapped, {columns: {5: {width: 30}}}));
    });

commander.command('get-data').action(async () => {
  await downloadStationData();
});

commander.command('clear-data').action(async () => {
  await fs.unlink(DATA_FILE_PATH);
});

commander.parse(process.argv);