// Fuel type of a car (offer report option):   node tests/fuel.test.mjs
import { fuelKind, fuelAllowed, fuelGroup } from '../packages/core/src/fuel.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const k = (model, model_code = null, fuel = null) => fuelKind({ model, model_code, fuel })

// real names and codes from the auction data
ok(k('A-CLASS A200D AMG LINE', '3DA-177012') === 'diesel', 'A200D is diesel')
ok(k('4 SERIES 420D XDRIVE GRAN COUPE M-SPORT', '3DA-12AV20') === 'diesel', '420D is diesel')
ok(k('3HB COOPER D', '3DA-XV15MW') === 'diesel' && k('5HB COOPER D', null) === 'diesel', 'MINI COOPER D is diesel (by code, and by name without a code)')
ok(k('DEFENDER 110 X D300', '3CA-LE72WAB') === 'diesel', 'D300 is diesel')
ok(k('RX350H VERSION L', '6AA-AALH10') === 'hybrid' && k('RX450HL', null) === 'hybrid' && k('RX500H F SPORT PERFORMANCE', '5AA-TALH17') === 'hybrid', 'RX350H / RX450HL / RX500H are hybrid')
ok(k('STEPWAGON SPADA EHEV SPADA PREMIUM LINE', '6AA-RP8') === 'hybrid', 'e:HEV is hybrid')
ok(k('STEPWAGON SPADA', '5BA-RP6') === 'petrol' && k('420I COUPE M-SPORT', '3BA-12AP20') === 'petrol' && k('GT-R BLACK EDITION', '4BA-R35') === 'petrol', '3BA / 5BA / 4BA are petrol')
ok(k('CIVIC TYPE R', '6BA-FL5') === 'petrol', '6BA is petrol')
ok(k('3HB COOPER SE', 'ZAA-22GC32') === 'ev' && k('TAYCAN OTHERS', 'ZAA-Y1A') === 'ev', 'ZAA is electric')
ok(k('E-CLASS E53 HYBRID 4MATIC+', '4LA-213') === 'hybrid', 'a HYBRID word in the name is hybrid')
ok(k('3 SERIES 330E M-SPORT', null) === 'phev', '330e is plug-in hybrid')
ok(k('LAND CRUISER ZX', '3DA-FJA300W') === 'diesel' && k('LAND CRUISER ZX', '3BA-VJA300W') === 'petrol', 'Land Cruiser: the code tells diesel from petrol')
ok(k('LAND CRUISER ZX', null) === null && k('LAND CRUISER ZX', 'FJA300W') === null, 'no clue = unknown (null), never guessed')
ok(k('RP7 STEPWAGON', 'RP7') === null, 'a code without its prefix is unknown')
// the sheet's fuel
ok(k('LAND CRUISER ZX', null, 'Diesel') === 'diesel' && k('LAND CRUISER ZX', null, '軽油') === 'diesel', 'the sheet fuel Diesel / 軽油 is diesel')
ok(k('LAND CRUISER ZX', null, 'Petrol') === 'petrol', 'the sheet fuel Petrol is petrol')
ok(k('RX350H VERSION L', null, 'Petrol') === 'hybrid', 'a hybrid name beats the sheet saying petrol (the sheet shows hybrids as gasoline)')
ok(k('SOMETHING', '6AA-XXX', 'Petrol') === 'hybrid', 'a hybrid code beats the sheet saying petrol')

// the switches
const off = { diesel: false, hybrid: false, plug: false }
ok(!fuelAllowed({ model: 'A200D AMG LINE', model_code: '3DA-177012' }, off), 'petrol only: a diesel is not allowed')
ok(!fuelAllowed({ model: 'RX350H', model_code: '6AA-AALH10' }, off), 'petrol only: a hybrid is not allowed')
ok(!fuelAllowed({ model: 'COOPER SE', model_code: 'ZAA-22GC32' }, off), 'petrol only: an electric is not allowed')
ok(fuelAllowed({ model: '420I COUPE', model_code: '3BA-12AP20' }, off), 'petrol only: petrol is allowed')
ok(fuelAllowed({ model: 'LAND CRUISER ZX', model_code: null }, off), 'petrol only: an unknown car is NOT excluded')
ok(fuelAllowed({ model: 'A200D AMG LINE', model_code: '3DA-177012' }, { ...off, diesel: true }), 'diesel switch on: the diesel is allowed')
ok(fuelAllowed({ model: 'RX350H', model_code: '6AA-AALH10' }, { ...off, hybrid: true }) && !fuelAllowed({ model: 'RX350H', model_code: '6AA-AALH10' }, { ...off, diesel: true }), 'only its own switch lets a hybrid through')
ok(fuelGroup('phev') === 'plug' && fuelGroup('ev') === 'plug' && fuelGroup('petrol') === null, 'plug-in and electric share one switch; petrol has none')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
