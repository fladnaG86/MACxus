// Entirely synthetic catalog data, embedded in the account-free PE probe.
// No account response, real catalog snapshot, local file path or secret is used.
export function storeProductFixtures() {
  const availability = { AvailabilityId: 'A1', Actions: ['Purchase', 'Details'],
    Conditions: { StartDate: '2020-01-01T00:00:00.0000000Z', EndDate: '2099-01-01T00:00:00.0000000Z' },
    OrderManagementData: { Price: { CurrencyCode: 'USD', ListPrice: 10, MSRP: 20 } } };
  const sku = { Sku: { SkuId: '0010', Properties: { IsTrial: false, Packages: [] } }, Availabilities: [availability] };
  const base = { Products: [{ ProductId: 'B00000000001', ProductType: 'Durable',
    LocalizedProperties: [{ ProductTitle: 'Synthetic add-on', ProductDescription: 'Public catalog does not grant ownership', Language: 'en-US' }],
    DisplaySkuAvailabilities: [sku] }] };
  const fixtures = { fixture: base };
  const change = (name, mutate) => { const value = structuredClone(base); mutate(value.Products[0], value); fixtures[name] = value; };
  change('unrequested', p => { p.ProductId = 'B00000000002'; });
  change('duplicate', (p, v) => v.Products.push(structuredClone(p)));
  change('bad-date', p => { p.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.EndDate = 'invalid'; });
  change('bad-price', p => { p.DisplaySkuAvailabilities[0].Availabilities[0].OrderManagementData.Price.ListPrice = -1; });
  change('bad-trial', p => { delete p.DisplaySkuAvailabilities[0].Sku.Properties.IsTrial; });
  change('empty-availability', p => { p.DisplaySkuAvailabilities[0].Availabilities = []; });
  change('future-availability', p => { p.DisplaySkuAvailabilities[0].Availabilities[0].Conditions.StartDate = '2090-01-01T00:00:00Z'; });
  change('packaged', p => { p.DisplaySkuAvailabilities[0].Sku.Properties.Packages = [{}]; });
  change('unknown-type', p => { p.ProductType = 'Other'; });
  change('two-skus', p => { const second = structuredClone(sku); second.Sku.SkuId = '0011'; second.Sku.Properties.IsTrial = true; p.DisplaySkuAvailabilities.push(second); });
  change('delisted', p => { const a = p.DisplaySkuAvailabilities[0].Availabilities[0]; a.Actions = ['Details', 'Redeem']; a.OrderManagementData.Price.ListPrice = a.OrderManagementData.Price.MSRP = 0; });
  for (const [name, detailsFirst, freePurchase] of [
    ['details-before-purchase', true, false], ['purchase-before-details', false, false],
    ['details-before-free-purchase', true, true], ['free-purchase-before-details', false, true],
  ]) {
    change(name, p => {
      const details = structuredClone(sku), purchase = structuredClone(sku);
      details.Sku.SkuId = '0011';
      details.Availabilities[0].Actions = ['Details', 'Redeem'];
      details.Availabilities[0].OrderManagementData.Price.ListPrice = freePurchase ? 10 : 0;
      details.Availabilities[0].OrderManagementData.Price.MSRP = freePurchase ? 20 : 0;
      if (freePurchase) {
        purchase.Availabilities[0].OrderManagementData.Price.ListPrice = 0;
        purchase.Availabilities[0].OrderManagementData.Price.MSRP = 0;
      }
      p.DisplaySkuAvailabilities = detailsFirst ? [details, purchase] : [purchase, details];
    });
  }
  return fixtures;
}

export function storeProductFixtureHeader() {
  return '/* Generated synthetic fixtures; no runtime file dependency. */\n' +
    'static const struct { const char *name, *json; } product_fixtures[] = {\n' +
    Object.entries(storeProductFixtures()).map(([name, value]) => `    {${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(value))}},`).join('\n') + '\n};\n';
}
