/* Pure finance presentation; authoritative actions remain with the room referee. */
export function liquidationValue(tile, property = {}) {
  return Math.floor(((Number(tile?.price) || 0) + (Number(property.level) || 0) * (Number(tile?.upgradeCost) || 0)) / 2);
}
export function ownedPropertyAssets(room, playerId, fallbackBoard = []) {
  if (playerId == null) return [];
  return (room?.board ?? fallbackBoard).filter(tile => tile.type === 'property').flatMap(tile => {
    const property = room?.properties?.[tile.id];
    if (!property || property.ownerId !== playerId || property.mortgaged) return [];
    const level = Number(property.level) || 0;
    const purchasePrice = Number(tile.price) || 0;
    const constructionValue = level * (Number(tile.upgradeCost) || 0);
    return [{tile, property, level, purchasePrice, constructionValue, assetValue: purchasePrice + constructionValue, liquidationValue: liquidationValue(tile, property)}];
  });
}
export function playerNetWorth(room, player, fallbackBoard = []) {
  if (typeof player?.netWorth === 'number' && Number.isFinite(player.netWorth)) return player.netWorth;
  return (Number(player?.cash) || 0) + ownedPropertyAssets(room, player?.id, fallbackBoard).reduce((sum, asset) => sum + asset.liquidationValue, 0);
}
