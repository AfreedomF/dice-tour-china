/* Pure, room-current tile information shared by the UI and tests. */
import {liquidationValue} from './finance-helpers.js';
export function tileDetails(room, tileId, fallbackBoard = []) {
  const route = room?.board ?? fallbackBoard;
  const tile = route.find(t => String(t.id) === String(tileId));
  if (!tile) return null;
  const property = room?.properties?.[tile.id];
  const owner = (room?.players ?? []).find(p => p.id === property?.ownerId);
  const level = property?.level ?? 0;
  const cityTiles = tile.city == null ? [] : route.filter(t => t.type === 'property' && t.city === tile.city);
  const cityMultiplier = property?.ownerId && cityTiles.length && cityTiles.every(t => room?.properties?.[t.id]?.ownerId === property.ownerId) ? 2 : 1;
  const rent = tile.type === 'property' && property?.ownerId && !property.mortgaged ? (tile.baseRent ?? 0) * (1 + level * 2) * cityMultiplier : 0;
  return {tile, property, owner, level, cityMultiplier, rent, purchasePrice: tile.price ?? 0, upgradeCost: tile.upgradeCost ?? 0, mortgaged: !!property?.mortgaged, liquidationValue: property?.ownerId && !property.mortgaged ? liquidationValue(tile, property) : 0};
}
