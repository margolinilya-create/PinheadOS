import { describe, it, expect } from 'vitest'
import { legacyRedirect, navFor, ORDER_NAV } from './orderNav'
import { ICONS } from '../../erp/components/icons'

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

describe('navFor — пункты меню по роли', () => {
  const paths = (role: string) => navFor(role).flatMap((g) => g.items.map((i) => i.to))

  it('manager: визард и экспресс-расчёт, без заказов v4, каталога и админки', () => {
    const p = paths('manager')
    expect(p).toContain('/')
    expect(p).toContain('/express')
    for (const hidden of ['/sales', '/sku', '/admin']) expect(p).not.toContain(hidden)
  })

  it('director видит все пять пунктов', () => {
    expect(paths('director')).toEqual(['/', '/sales', '/express', '/sku', '/admin'])
  })

  it('production: только визард, пустые группы выкинуты', () => {
    expect(paths('production')).toEqual(['/'])
    expect(navFor('production')).toHaveLength(1)
  })

  it('иконка каждого пункта есть в наборе ERP', () => {
    for (const g of ORDER_NAV) for (const i of g.items) expect(ICONS).toHaveProperty(i.icon)
  })
})
