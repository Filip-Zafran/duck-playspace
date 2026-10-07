import XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const headerKey = value => normalize(value);
const splitNames = value => String(value ?? '').split(/[;,|\n]+/).map(name => name.trim()).filter(Boolean);

function parseNumber(value, label, rowNumber) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[€\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) throw new Error(`Row ${rowNumber}: ${label} must be a non-negative whole number.`);
  return parsed;
}

function parseMoney(value, label, rowNumber) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[€\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || Math.round(parsed * 100) !== parsed * 100) throw new Error(`Row ${rowNumber}: ${label} must be a non-negative amount with up to two decimal places.`);
  return parsed;
}

function parseYesNo(value, label, rowNumber, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'paid', 'attended'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0', 'unpaid', 'not attended'].includes(normalized)) return false;
  throw new Error(`Row ${rowNumber}: ${label} must be Yes or No.`);
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const makeCalendarDate = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return makeCalendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return makeCalendarDate(date.y, date.m, date.d);
  }
  const raw = String(value).trim();
  const isoDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    const date = makeCalendarDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    if (date) return date;
    throw new Error(`Could not read event date “${raw}”.`);
  }
  const monthDate = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthDate) {
    const month = new Date(`${monthDate[1]} 1, 2000`).getMonth() + 1;
    const date = makeCalendarDate(Number(monthDate[3]), month, Number(monthDate[2]));
    if (date) return date;
  }
  const slashDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashDate) {
    const first = Number(slashDate[1]), second = Number(slashDate[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    const rawYear = Number(slashDate[3]);
    const year = slashDate[3].length === 2 ? (rawYear < 50 ? 2000 + rawYear : 1900 + rawYear) : rawYear;
    const date = makeCalendarDate(year, month, day);
    if (date) return date;
    throw new Error(`Could not read event date “${raw}”.`);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
  throw new Error(`Could not read event date “${raw}”.`);
}

function makeStats(people) {
  const byName = new Map();
  for (const person of people) {
    const key = normalize(person.name);
    if (!key) throw new Error(`Could not read a name for ${person.email}.`);
    if (byName.has(key) && byName.get(key).email.toLowerCase() !== person.email.toLowerCase()) {
      throw new Error(`The file has multiple participants named “${person.name}”; use an Excel file with explicit email fields for the interest lists.`);
    }
    byName.set(key, person);
  }
  for (const person of people) {
    person.romanticNames ||= [];
    person.socialNames ||= [];
    person.romanticTargets = person.romanticNames.map(name => byName.get(normalize(name))).filter(Boolean);
    person.socialTargets = person.socialNames.map(name => byName.get(normalize(name))).filter(Boolean);
    const unresolved = [...person.romanticNames, ...person.socialNames].filter(name => !byName.has(normalize(name)));
    if (unresolved.length) throw new Error(`Could not match interest name(s) for ${person.name}: ${[...new Set(unresolved)].join(', ')}.`);
  }

  return people.map(person => {
    const romanticReceived = people.filter(other => other.romanticTargets.some(target => target.email.toLowerCase() === person.email.toLowerCase())).length;
    const socialReceived = people.filter(other => other.socialTargets.some(target => target.email.toLowerCase() === person.email.toLowerCase())).length;
    const romanticMatches = person.romanticTargets.filter(target => target.romanticTargets.some(candidate => candidate.email.toLowerCase() === person.email.toLowerCase())).length;
    const socialMatches = person.socialTargets.filter(target => target.socialTargets.some(candidate => candidate.email.toLowerCase() === person.email.toLowerCase())).length;
    const paid = person.paid ?? true;
    const freeEntry = person.freeEntry ?? false;
    return {
      name: person.name, email: person.email,
      attended: person.attended ?? true, paid,
      dateAttended: person.dateAttended ?? null,
      amount: !paid || freeEntry ? 0 : (person.amount ?? person.eventFee ?? 5),
      freeEntry,
      romanticLikesGiven: person.romanticLikesGiven ?? person.romanticTargets.length,
      socialLikesGiven: person.socialLikesGiven ?? person.socialTargets.length,
      romanticLikesReceived: person.romanticLikesReceived ?? romanticReceived,
      socialLikesReceived: person.socialLikesReceived ?? socialReceived,
      romanticMatches: person.romanticMatches ?? romanticMatches,
      socialMatches: person.socialMatches ?? socialMatches
    };
  });
}

async function extractPdfLines(buffer) {
  const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => String(item.str || '').trim()).filter(Boolean));
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

async function parsePdf(buffer) {
  const pages = await extractPdfLines(buffer);
  const allLines = pages.flat();
  const firstPage = pages[0] || [];
  const eventLine = firstPage.find(line => /\/\s*\d+(?:st|nd|rd|th)$/i.test(line));
  const eventName = eventLine?.replace(/\/\s*\d+(?:st|nd|rd|th)$/i, '').trim();
  const rawDate = allLines.find(line => /^[A-Za-z]+\s+\d{1,2},\s+\d{4}$/.test(line));
  if (!eventName || !rawDate) throw new Error('Could not identify the event name and date in this PDF. Upload an event admin printout or use the Excel template.');
  const date = parseDate(rawDate);

  const anchors = [];
  for (let index = 0; index < allLines.length; index += 1) {
    const emailMatch = allLines[index].match(/^\(?([^\s()]+@[^\s()]+)\)?$/);
    if (!emailMatch) continue;
    let nameIndex = index - 1;
    while (nameIndex >= 0 && /^[\uE000-\uF8FF\s]+$/.test(allLines[nameIndex])) nameIndex -= 1;
    if (nameIndex < 0 || allLines[nameIndex].includes('@')) continue;
    anchors.push({ name: allLines[nameIndex].replace(/^[^\p{L}\p{N}]+/u, '').trim(), email: emailMatch[1].replace(/[),]+$/, ''), lineIndex: index });
  }
  const people = anchors.map(anchor => {
    const nextAnchor = anchors.find(candidate => candidate.lineIndex > anchor.lineIndex);
    const block = allLines.slice(anchor.lineIndex, nextAnchor?.lineIndex ?? allLines.length);
    let section = '';
    const romanticNames = [];
    const socialNames = [];
    for (const line of block) {
      if (/^(events?|users|log out|duck dating apps|back to|edit|event|remove from event|\d{2}\/\d{2}\/\d{4},?\s+\d{2}:\d{2}|https?:\/\/.*|\d+\/\d+)$/i.test(line.trim())) continue;
      if (/^ROMANTIC INTERESTS:?$/i.test(line)) { section = 'romantic'; continue; }
      if (/^SOCIAL INTERESTS:?$/i.test(line)) { section = 'social'; continue; }
      if (/^Matches Preview:?$/i.test(line)) { section = ''; break; }
      if (section && normalize(line) && !/^None$/i.test(line) && !/^Interest Summary:?$/i.test(line)) (section === 'romantic' ? romanticNames : socialNames).push(line);
    }
    return { name: anchor.name, email: anchor.email, romanticNames, socialNames };
  });
  const uniquePeople = [...new Map(people.map(person => [person.email.toLowerCase(), person])).values()];
  if (!uniquePeople.length) throw new Error('This PDF does not contain participant emails. Upload an event admin printout or use the Excel template.');
  return { eventName, date, fee: 5, people: makeStats(uniquePeople) };
}

function parseSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('The Excel file has no worksheet.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '', raw: true });
  if (!rows.length) throw new Error('The first worksheet has no data rows.');
  const source = rows.map(row => new Map(Object.entries(row).map(([key, value]) => [headerKey(key), value])));
  const read = (values, ...aliases) => {
    for (const alias of aliases) if (values.has(headerKey(alias))) {
      const value = values.get(headerKey(alias));
      return value === '' || value === null || value === undefined ? null : (value instanceof Date ? value : String(value).trim());
    }
    return null;
  };
  const readRaw = (values, ...aliases) => {
    for (const alias of aliases) if (values.has(headerKey(alias))) {
      const value = values.get(headerKey(alias));
      return value === '' || value === null || value === undefined ? null : value;
    }
    return null;
  };
  const first = source[0];
  const eventName = read(first, 'Event Name', 'Event');
  if (!eventName) throw new Error('Add an “Event Name” column to the Excel file.');
  const eventDate = parseDate(readRaw(first, 'Event Date', 'Date'));
  const eventFee = parseMoney(read(first, 'Participation Fee', 'Event Fee'), 'Participation Fee', 2) ?? 5;
  const people = source.map((values, index) => {
    const rowNumber = index + 2;
    const email = read(values, 'Participant Email', 'Email');
    if (!email) throw new Error(`Row ${rowNumber}: Participant Email is required.`);
    const rowEvent = read(values, 'Event Name', 'Event');
    if (rowEvent && rowEvent.toLowerCase() !== eventName.toLowerCase()) throw new Error('Upload one event per file. The Excel file contains more than one event name.');
    const romanticNames = splitNames(read(values, 'Romantic Interests', 'Romantic Likes To'));
    const socialNames = splitNames(read(values, 'Social Interests', 'Social Likes To'));
    const attended = parseYesNo(read(values, 'Attended', 'Attended Event'), 'Attended', rowNumber, true);
    const dateAttended = parseYesNo(read(values, 'Went On Date', 'Had Date', 'Date Attended'), 'Went On Date', rowNumber);
    const paid = parseYesNo(read(values, 'Paid'), 'Paid', rowNumber, true);
    const freeEntry = parseYesNo(read(values, 'Free Entry'), 'Free Entry', rowNumber, false);
    return {
      name: read(values, 'Participant Name', 'Name') || email,
      email, romanticNames, socialNames, attended, dateAttended, paid, freeEntry,
      amount: parseMoney(read(values, 'Amount', 'Amount Paid'), 'Amount', rowNumber), eventFee,
      romanticLikesGiven: parseNumber(read(values, 'Romantic Likes Given'), 'Romantic Likes Given', rowNumber),
      socialLikesGiven: parseNumber(read(values, 'Social Likes Given'), 'Social Likes Given', rowNumber),
      romanticLikesReceived: parseNumber(read(values, 'Romantic Likes Received'), 'Romantic Likes Received', rowNumber),
      socialLikesReceived: parseNumber(read(values, 'Social Likes Received'), 'Social Likes Received', rowNumber),
      romanticMatches: parseNumber(read(values, 'Romantic Matches'), 'Romantic Matches', rowNumber),
      socialMatches: parseNumber(read(values, 'Social Matches'), 'Social Matches', rowNumber)
    };
  });
  const unique = [...new Map(people.map(person => [person.email.toLowerCase(), person])).values()];
  if (unique.length !== people.length) throw new Error('The Excel file contains a participant email more than once.');
  return { eventName, date: eventDate, fee: eventFee, people: makeStats(unique) };
}

export async function parseEventUpload(file) {
  const extension = String(file.originalname || '').split('.').pop().toLowerCase();
  if (extension === 'pdf' || file.mimetype === 'application/pdf') return parsePdf(file.buffer);
  if (['xlsx', 'xls', 'csv'].includes(extension)) return parseSpreadsheet(file.buffer);
  throw new Error('Choose a PDF, Excel (.xlsx/.xls), or CSV event file.');
}
