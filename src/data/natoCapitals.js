// NATO member states + Ukraine: capitals with coordinates.
// Public reference data. euCore=true marks the European theatre preset
// (US, Canada and Iceland are selectable manually; including them stretches
// the map across the Atlantic).
export const NATO_COUNTRIES = [
  { code: 'AL', name: 'Albania',         capital: 'Tirana',      lat: 41.3275, lng: 19.8187, euCore: true },
  { code: 'BE', name: 'Belgium',         capital: 'Brussels',    lat: 50.8503, lng: 4.3517,  euCore: true },
  { code: 'BG', name: 'Bulgaria',        capital: 'Sofia',       lat: 42.6977, lng: 23.3219, euCore: true },
  { code: 'CA', name: 'Canada',          capital: 'Ottawa',      lat: 45.4215, lng: -75.6972, euCore: false },
  { code: 'HR', name: 'Croatia',         capital: 'Zagreb',      lat: 45.8150, lng: 15.9819, euCore: true },
  { code: 'CZ', name: 'Czechia',         capital: 'Prague',      lat: 50.0755, lng: 14.4378, euCore: true },
  { code: 'DK', name: 'Denmark',         capital: 'Copenhagen',  lat: 55.6761, lng: 12.5683, euCore: true },
  { code: 'EE', name: 'Estonia',         capital: 'Tallinn',     lat: 59.4370, lng: 24.7536, euCore: true },
  { code: 'FI', name: 'Finland',         capital: 'Helsinki',    lat: 60.1699, lng: 24.9384, euCore: true },
  { code: 'FR', name: 'France',          capital: 'Paris',       lat: 48.8566, lng: 2.3522,  euCore: true },
  { code: 'DE', name: 'Germany',         capital: 'Berlin',      lat: 52.5200, lng: 13.4050, euCore: true },
  { code: 'GR', name: 'Greece',          capital: 'Athens',      lat: 37.9838, lng: 23.7275, euCore: true },
  { code: 'HU', name: 'Hungary',         capital: 'Budapest',    lat: 47.4979, lng: 19.0402, euCore: true },
  { code: 'IS', name: 'Iceland',         capital: 'Reykjavik',   lat: 64.1466, lng: -21.9426, euCore: false },
  { code: 'IT', name: 'Italy',           capital: 'Rome',        lat: 41.9028, lng: 12.4964, euCore: true },
  { code: 'LV', name: 'Latvia',          capital: 'Riga',        lat: 56.9496, lng: 24.1052, euCore: true },
  { code: 'LT', name: 'Lithuania',       capital: 'Vilnius',     lat: 54.6872, lng: 25.2797, euCore: true },
  { code: 'LU', name: 'Luxembourg',      capital: 'Luxembourg',  lat: 49.6116, lng: 6.1319,  euCore: true },
  { code: 'ME', name: 'Montenegro',      capital: 'Podgorica',   lat: 42.4304, lng: 19.2594, euCore: true },
  { code: 'NL', name: 'Netherlands',     capital: 'Amsterdam',   lat: 52.3676, lng: 4.9041,  euCore: true },
  { code: 'MK', name: 'North Macedonia', capital: 'Skopje',      lat: 41.9973, lng: 21.4280, euCore: true },
  { code: 'NO', name: 'Norway',          capital: 'Oslo',        lat: 59.9139, lng: 10.7522, euCore: true },
  { code: 'PL', name: 'Poland',          capital: 'Warsaw',      lat: 52.2297, lng: 21.0122, euCore: true },
  { code: 'PT', name: 'Portugal',        capital: 'Lisbon',      lat: 38.7223, lng: -9.1393, euCore: true },
  { code: 'RO', name: 'Romania',         capital: 'Bucharest',   lat: 44.4268, lng: 26.1025, euCore: true },
  { code: 'SK', name: 'Slovakia',        capital: 'Bratislava',  lat: 48.1486, lng: 17.1077, euCore: true },
  { code: 'SI', name: 'Slovenia',        capital: 'Ljubljana',   lat: 46.0569, lng: 14.5058, euCore: true },
  { code: 'ES', name: 'Spain',           capital: 'Madrid',      lat: 40.4168, lng: -3.7038, euCore: true },
  { code: 'SE', name: 'Sweden',          capital: 'Stockholm',   lat: 59.3293, lng: 18.0686, euCore: true },
  { code: 'TR', name: 'T\u00fcrkiye',    capital: 'Ankara',      lat: 39.9334, lng: 32.8597, euCore: true },
  { code: 'UK', name: 'United Kingdom',  capital: 'London',      lat: 51.5074, lng: -0.1278, euCore: true },
  { code: 'US', name: 'United States',   capital: 'Washington',  lat: 38.9072, lng: -77.0369, euCore: false },
  { code: 'UA', name: 'Ukraine',         capital: 'Kyiv',        lat: 50.4501, lng: 30.5234, euCore: true },
];

// Real-world threat-origin points for the European theatre. Threats to NATO/UA
// originate from adversary territory and sea-launch boxes, not from inside Europe.
// Coordinates are representative launch areas (public knowledge), not specific sites.
export const THREAT_ORIGINS = [
  { id: 'ru_west',     label: 'Russia (western MD)',     lat: 54.7,  lng: 36.0,  group: 'RU' },
  { id: 'ru_south',    label: 'Russia (southern MD)',    lat: 47.2,  lng: 39.7,  group: 'RU' },
  { id: 'ru_kaliningrad', label: 'Kaliningrad',          lat: 54.7,  lng: 20.5,  group: 'RU' },
  { id: 'ru_north',    label: 'Russia (Arctic/Kola)',    lat: 68.9,  lng: 33.1,  group: 'RU' },
  { id: 'by',          label: 'Belarus',                 lat: 53.9,  lng: 27.6,  group: 'RU' },
  { id: 'sea_black',   label: 'Black Sea (naval)',       lat: 43.5,  lng: 31.5,  group: 'SEA' },
  { id: 'sea_baltic',  label: 'Baltic Sea (naval)',      lat: 55.5,  lng: 18.5,  group: 'SEA' },
  { id: 'sea_north',   label: 'North Sea / Norwegian Sea', lat: 60.0, lng: 2.0,  group: 'SEA' },
  { id: 'sea_med',     label: 'E. Mediterranean (naval)', lat: 34.5, lng: 26.0,  group: 'SEA' },
  { id: 'iran',        label: 'Iran (south-east axis)',  lat: 35.7,  lng: 51.4,  group: 'IR' },
];
