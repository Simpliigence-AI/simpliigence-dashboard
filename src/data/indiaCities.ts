/** Lookup table of major Indian cities → [longitude, latitude] (GeoJSON order). */

interface IndiaCity {
  name: string;
  /** Lowercase aliases that should match this city when parsed from a location string. */
  aliases: string[];
  /** [longitude, latitude] — GeoJSON order */
  coords: [number, number];
}

export const INDIA_CITIES: IndiaCity[] = [
  { name: 'Bangalore',         aliases: ['bangalore', 'bengaluru'],                coords: [77.5946, 12.9716] },
  { name: 'Hyderabad',         aliases: ['hyderabad', 'secunderabad'],             coords: [78.4867, 17.3850] },
  { name: 'Pune',              aliases: ['pune', 'poona'],                         coords: [73.8567, 18.5204] },
  { name: 'Chennai',           aliases: ['chennai', 'madras'],                     coords: [80.2707, 13.0827] },
  { name: 'Mumbai',            aliases: ['mumbai', 'bombay', 'navi mumbai', 'thane'], coords: [72.8777, 19.0760] },
  { name: 'Delhi NCR',         aliases: ['delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'faridabad'], coords: [77.2090, 28.6139] },
  { name: 'Kolkata',           aliases: ['kolkata', 'calcutta'],                   coords: [88.3639, 22.5726] },
  { name: 'Ahmedabad',         aliases: ['ahmedabad', 'gandhinagar'],              coords: [72.5714, 23.0225] },
  { name: 'Jaipur',            aliases: ['jaipur'],                                coords: [75.7873, 26.9124] },
  { name: 'Kochi',             aliases: ['kochi', 'cochin', 'ernakulam'],          coords: [76.2673,  9.9312] },
  { name: 'Coimbatore',        aliases: ['coimbatore'],                            coords: [76.9558, 11.0168] },
  { name: 'Indore',            aliases: ['indore'],                                coords: [75.8577, 22.7196] },
  { name: 'Chandigarh',        aliases: ['chandigarh', 'mohali', 'panchkula'],     coords: [76.7794, 30.7333] },
  { name: 'Lucknow',           aliases: ['lucknow'],                               coords: [80.9462, 26.8467] },
  { name: 'Bhubaneswar',       aliases: ['bhubaneswar', 'bhubaneshwar', 'cuttack'], coords: [85.8245, 20.2961] },
  { name: 'Visakhapatnam',     aliases: ['visakhapatnam', 'vizag', 'vishakhapatnam'], coords: [83.2185, 17.6868] },
  { name: 'Mysuru',            aliases: ['mysore', 'mysuru'],                      coords: [76.6394, 12.2958] },
  { name: 'Mangaluru',         aliases: ['mangalore', 'mangaluru'],                coords: [74.8560, 12.9141] },
  { name: 'Thiruvananthapuram',aliases: ['thiruvananthapuram', 'trivandrum'],      coords: [76.9366,  8.5241] },
  { name: 'Nagpur',            aliases: ['nagpur'],                                coords: [79.0882, 21.1458] },
  { name: 'Surat',             aliases: ['surat'],                                 coords: [72.8311, 21.1702] },
  { name: 'Vadodara',          aliases: ['vadodara', 'baroda'],                    coords: [73.1812, 22.3072] },
  { name: 'Bhopal',            aliases: ['bhopal'],                                coords: [77.4126, 23.2599] },
  { name: 'Patna',             aliases: ['patna'],                                 coords: [85.1376, 25.5941] },
  { name: 'Madurai',           aliases: ['madurai'],                               coords: [78.1198,  9.9252] },
  { name: 'Vijayawada',        aliases: ['vijayawada'],                            coords: [80.6480, 16.5062] },
  { name: 'Nashik',            aliases: ['nashik', 'nasik'],                       coords: [73.7898, 19.9975] },
  { name: 'Ranchi',            aliases: ['ranchi'],                                coords: [85.3240, 23.3441] },
  { name: 'Guwahati',          aliases: ['guwahati'],                              coords: [91.7362, 26.1445] },
  { name: 'Dehradun',          aliases: ['dehradun'],                              coords: [78.0322, 30.3165] },
  { name: 'Goa',               aliases: ['goa', 'panaji', 'panjim', 'margao'],     coords: [73.8278, 15.4989] },
];

/** Find an Indian city in a free-text location string. Returns null if no match. */
export function matchIndianCity(location: string | null | undefined): IndiaCity | null {
  if (!location) return null;
  const norm = location.toLowerCase();
  for (const city of INDIA_CITIES) {
    for (const alias of city.aliases) {
      // Word-boundary-ish match: alias surrounded by whitespace, commas, parens, or string boundaries
      const re = new RegExp(`(^|[^a-z])${alias.replace(/\s+/g, '\\s+')}([^a-z]|$)`, 'i');
      if (re.test(norm)) return city;
    }
  }
  return null;
}
