/** Fill down series rules (YAZ-3765, YAZ-3696 🔒 S4). */
import { describe, expect, it } from 'vitest'
import { fillSeries } from './fillSeries'

describe('fillSeries: two or more cells continue their step', () => {
  it.each([
    [['1', '2'], ['3', '4']],
    [['10', '20', '30'], ['40', '50']],
    [['5', '3'], ['1', '-1']],
    [['0.5', '0.75'], ['1.00', '1.25']],
    [['1.5', '2.5'], ['3.5', '4.5']],
    [['0.1', '0.2'], ['0.3', '0.4']],
  ])('numbers %j → %j', (source, out) => expect(fillSeries(source, out.length)).toEqual(out))

  it.each([
    [['4:00', '4:30'], ['5:00', '5:30']],
    [['04:00', '04:30'], ['05:00', '05:30']],
    [['23:00', '23:30'], ['0:00', '0:30']],
  ])('times %j → %j', (source, out) => expect(fillSeries(source, out.length)).toEqual(out))

  it.each([
    [['2026-10-30', '2026-10-31'], ['2026-11-01', '2026-11-02']],
    [['2026-12-24', '2026-12-31'], ['2027-01-07']],
    [['2028-02-27', '2028-02-28'], ['2028-02-29', '2028-03-01']],
  ])('dates %j → %j', (source, out) => expect(fillSeries(source, out.length)).toEqual(out))

  it('text with the same words and a number continues the number step', () => {
    expect(fillSeries(['Week 2', 'Week 4'], 2)).toEqual(['Week 6', 'Week 8'])
  })
})

describe('fillSeries: weekday and month names continue, from one cell', () => {
  it.each([
    [['Monday'], ['Tuesday', 'Wednesday']],
    [['Sat'], ['Sun', 'Mon']],
    [['FRI'], ['SAT']],
    [['sunday'], ['monday']],
    [['Mon', 'Wed'], ['Fri', 'Sun']],
    [['November'], ['December', 'January']],
    [['Dec'], ['Jan', 'Feb']],
    [['MAR'], ['APR']],
    [['May'], ['June']],
  ])('%j → %j', (source, out) => expect(fillSeries(source, out.length)).toEqual(out))
})

describe('fillSeries: text that ends in a number continues, from one cell', () => {
  it.each([
    [['Week 1'], ['Week 2', 'Week 3']],
    [['Item 09'], ['Item 10', 'Item 11']],
    [['Q3'], ['Q4']],
  ])('%j → %j', (source, out) => expect(fillSeries(source, out.length)).toEqual(out))
})

describe('fillSeries: anything else is copied, the pattern in order', () => {
  it.each([
    [['apple'], ['apple', 'apple']],
    [['5'], ['5', '5']],
    [['4:00'], ['4:00']],
    [['2026-10-30'], ['2026-10-30']],
    [['a', 'b'], ['a', 'b', 'a']],
    [['1', 'x'], ['1', 'x', '1']],
    [['Week 1', 'Day 2'], ['Week 1', 'Day 2']],
    [['Monday', 'March'], ['Monday', 'March']],
    [[''], ['', '']],
  ])('%j → %j', (source, out) => expect(fillSeries(source, out.length)).toEqual(out))

  it('a count of 0 gives nothing', () => expect(fillSeries(['1', '2'], 0)).toEqual([]))
})
