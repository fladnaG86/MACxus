import { expect, it, vi } from 'vitest';
import { CatalogService } from './catalog';
const ID='ABCDEFGHIJKL';
const response=()=>({ Products:[{ ProductId:ID,ProductType:'Game',LocalizedProperties:[{ProductTitle:'Sample Game',ProductDescription:'<script>literal text</script>',PublisherName:'Example',Images:[null,{ImagePurpose:'BoxArt',Uri:'//store-images.s-microsoft.com/box'},{ImagePurpose:'Hero',Uri:'https://store-images.s-microsoft.com/hero'},{ImagePurpose:'Screenshot',Uri:'//store-images.s-microsoft.com/one'},{ImagePurpose:'Screenshot',Uri:'https://store-images.s-microsoft.com/one'},{ImagePurpose:'Screenshot',Uri:'https://evil.test/image'},{ImagePurpose:'Screenshot',Uri:'file:///etc/passwd'}]}],Properties:{Categories:['Strategy','Card & board',null]},MarketProperties:[{OriginalReleaseDate:'2024-02-20T00:00:00Z'}]}] });
it('reads catalog metadata without pretending package support or ownership, filtering and deduplicating gallery images',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(response()))); const catalog=new CatalogService(fetcher as typeof fetch);
  const details=await catalog.gameDetails(ID,'US');
  expect(details).toMatchObject({title:'Sample Game',description:'<script>literal text</script>',categories:['Strategy','Card & board'],screenshots:['https://store-images.s-microsoft.com/one'],heroUrl:'https://store-images.s-microsoft.com/hero'});
  expect(details).not.toHaveProperty('installability');
  details!.screenshots.push('changed'); expect((await catalog.gameDetails(ID,'US'))!.screenshots).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
  await catalog.gameDetails(ID,'CZ'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('reads the decimal Xbox title ID from AlternateIds and drops malformed values',async()=>{
  const withIds=(Value: unknown)=>{ const body=response(); (body.Products[0] as Record<string, unknown>).AlternateIds=[{IdType:'LegacyWindowsStoreProductId',Value:'x'},{IdType:'XboxTitleId',Value}]; return body; };
  const fetcher=vi.fn(async(url: URL)=>new Response(JSON.stringify(withIds(String(url).includes('market=US') ? '1743309413' : '0x67E5'))));
  const catalog=new CatalogService(fetcher as unknown as typeof fetch);
  expect((await catalog.gameDetails(ID,'US'))?.titleId).toBe('1743309413');
  expect((await catalog.gameDetails(ID,'CZ'))?.titleId).toBeUndefined();
});
it('fails honestly when metadata is missing and rejects malformed IDs before a request',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}')); const catalog=new CatalogService(fetcher as typeof fetch);
  await expect(catalog.gameDetails('../bad','US')).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  expect(await catalog.gameDetails(ID,'US')).toBeUndefined();
});
