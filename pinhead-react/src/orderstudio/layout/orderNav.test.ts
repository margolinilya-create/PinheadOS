import { describe, it, expect } from 'vitest'
import { legacyRedirect } from './orderNav'

describe('legacyRedirect — старые адреса ведут на рабочие экраны', () => {
  it('/orders: admin и director -> /sales', () => {
    expect(legacyRedirect('/orders', 'admin')).toBe('/sales')
    expect(legacyRedirect('/orders', 'director')).toBe('/sales')
  })

  it('/orders: остальные роли -> /', () => {
    expect(legacyRedirect('/orders', 'manager')).toBe('/')
    expect(legacyRedirect('/orders', 'production')).toBe('/')
  })

  it('/print и /analytics -> / для любой роли', () => {
    expect(legacyRedirect('/print', 'admin')).toBe('/')
    expect(legacyRedirect('/analytics', 'rop')).toBe('/')
  })

  it('неизвестный адрес -> /', () => {
    expect(legacyRedirect('/что-то', 'admin')).toBe('/')
  })
})
