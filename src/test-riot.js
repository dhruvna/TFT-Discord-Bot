import 'dotenv/config';
import { getAccountByRiotId } from './riot.js';

const region = 'americas'; // change if needed
const gameName = 'ProMembean';
const tagLine = 'na2';

const account = await getAccountByRiotId({ region, gameName, tagLine });
console.log(account);
 
