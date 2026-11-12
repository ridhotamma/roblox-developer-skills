#!/usr/bin/env node
// Checks the scanner's rules against small fixtures, and that the bundled kit (and the
// roblox-project-structure template, if installed alongside) scan clean of high/critical.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanPath } = require('./scan.cjs');

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failed++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsec-'));
const write = (rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};

// --- fixtures -------------------------------------------------------------------------

write('bad/server/Shop.server.luau', `
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService = game:GetService("MarketplaceService")
local GiveCoins = ReplicatedStorage:WaitForChild("GiveCoins")

GiveCoins.OnServerEvent:Connect(function(player, amount)
	player.leaderstats.Coins.Value += amount
end)

ReplicatedStorage.Buy.OnServerEvent:Connect(function(player, itemId, price)
	player.leaderstats.Coins.Value -= price
end)

workspace.Coin.Touched:Connect(function(hit)
	local player = game.Players:GetPlayerFromCharacter(hit.Parent)
	if player then
		player.leaderstats.Coins.Value += 10
	end
end)

MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, purchased)
	print(userId)
end)

MarketplaceService.ProcessReceipt = function(receiptInfo)
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

local remote = ReplicatedStorage.Ask
local answer = remote:InvokeClient(game.Players:GetPlayers()[1])
_G.Money = 5
`);

write('bad/server/Other.server.luau', `
game:GetService("MarketplaceService").ProcessReceipt = function(info)
	if info.PurchaseId then return Enum.ProductPurchaseDecision.PurchaseGranted end
end
`);

write('bad/shared/Config.luau', `
local DataStoreService = game:GetService("DataStoreService")
local WEBHOOK = "https://discord.com/api/webhooks/123456/abcdefghijklmnop"
return {}
`);

write('backdoor/Model.server.lua', `
local a = require(4419324023)
local s = "\\108\\111\\97\\100\\115\\116\\114\\105\\110\\103\\40\\34\\112\\114\\105\\110\\116\\34\\41\\41"
getfenv()[string.reverse("gnirtsdaol")](s)()
loadstring("print(1)")()
`);

write('clean/server/Services/ShopService.luau', `
local Validate = require(script.Parent.Parent.Security.Validate)
-- a comment mentioning require(123456789) and loadstring( must not trigger
Net.Handle("Buy", 2, function(player, rawItemId)
	local item = Validate.OneOf(rawItemId, Items)
	if not item then return end
end)

coin.Touched:Connect(function(hit)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	if not player or not Validate.Near(player, coin.Position, 8) then return end
	CurrencyService:Add(player, 5, "Coin")
end)

honeypot.OnServerEvent:Connect(function(player, payload) -- scan:ignore unvalidated-handler
	Sanctions.Ban(player, "Honeypot")
end)
`);

write('place/game.rbxlx', `<roblox version="4">
<Item class="Workspace" referent="RBX1"><Properties><string name="Name">Workspace</string></Properties>
  <Item class="Model" referent="RBX2"><Properties><string name="Name">FreeTree</string></Properties>
    <Item class="Script" referent="RBX3"><Properties><string name="Name">Vaccine</string>
      <ProtectedString name="Source"><![CDATA[local x = require(0x1A2B3C4D)]]></ProtectedString></Properties></Item>
  </Item>
</Item>
<Item class="ServerScriptService" referent="RBX4"><Properties><string name="Name">ServerScriptService</string><bool name="LoadStringEnabled">true</bool></Properties></Item>
<Item class="ReplicatedStorage" referent="RBX5"><Properties><string name="Name">ReplicatedStorage</string></Properties>
  <Item class="RemoteEvent" referent="RBX6"><Properties><string name="Name">AddCash</string></Properties></Item>
  <Item class="ModuleScript" referent="RBX7"><Properties><string name="Name">Saver</string>
    <ProtectedString name="Source">local ds = game:GetService(&quot;DataStoreService&quot;)
return {}</ProtectedString></Properties></Item>
</Item>
</roblox>`);

write('binary/game.rbxl', 'not xml');

// --- assertions -----------------------------------------------------------------------

const has = (res, rule, whereRe) => res.findings.some((f) => f.rule === rule && (!whereRe || whereRe.test(f.where)));
const count = (res, rule) => res.findings.filter((f) => f.rule === rule).length;

const bad = scanPath(path.join(dir, 'bad'));
check('outcome-remote (GiveCoins)', has(bad, 'outcome-remote', /Shop/));
check('client-sent-amount (amount, price)', count(bad, 'client-sent-amount') === 2, JSON.stringify(bad.findings.map((f) => f.rule)));
check('unvalidated-handler', count(bad, 'unvalidated-handler') === 2);
check('interaction-no-distance (Touched reward)', has(bad, 'interaction-no-distance'));
check('product-purchase-finished', has(bad, 'product-purchase-finished'));
check('receipt-not-idempotent (only the file without PurchaseId)', count(bad, 'receipt-not-idempotent') === 1);
check('multiple-process-receipt', has(bad, 'multiple-process-receipt'));
check('invoke-client', has(bad, 'invoke-client'));
check('global-state', has(bad, 'global-state'));
check('webhook-or-key', has(bad, 'webhook-or-key', /Config/));
check('server-api-in-client (shared module)', has(bad, 'server-api-in-client', /shared/));

const bd = scanPath(path.join(dir, 'backdoor'));
check('require-asset-id', has(bd, 'require-asset-id'));
check('env-manipulation', has(bd, 'env-manipulation'));
check('loadstring', has(bd, 'loadstring'));
check('obfuscated-string', has(bd, 'obfuscated-string'));

const clean = scanPath(path.join(dir, 'clean'));
check('clean code: no findings', clean.findings.length === 0, JSON.stringify(clean.findings, null, 1));

const place = scanPath(path.join(dir, 'place', 'game.rbxlx'));
check('rbxlx: require hex id in Workspace model', has(place, 'require-asset-id', /FreeTree\.Vaccine/));
check('rbxlx: LoadStringEnabled', has(place, 'loadstring-enabled'));
check('rbxlx: outcome RemoteEvent AddCash', has(place, 'outcome-remote', /AddCash/));
check('rbxlx: DataStoreService in ReplicatedStorage module', has(place, 'server-api-in-client', /Saver/));
check('rbxlx: suspicious script name', has(place, 'suspicious-script-name'));
check('rbxlx: workspace-scripts info', has(place, 'workspace-scripts'));

const bin = scanPath(path.join(dir, 'binary'));
check('binary place is skipped with a message', bin.skipped.length === 1);

// Bundled code must not trip high/critical rules.
const serious = (res) => res.findings.filter((f) => f.severity === 'high' || f.severity === 'critical');
const kit = scanPath(path.join(__dirname, '..', 'assets', 'kit'));
check('kit scans clean (no high/critical)', serious(kit).length === 0, JSON.stringify(serious(kit), null, 1));
check('kit scans clean (no medium)', kit.findings.filter((f) => f.severity === 'medium').length === 0, JSON.stringify(kit.findings, null, 1));

const template = path.join(__dirname, '..', '..', 'roblox-project-structure', 'assets', 'template', 'src');
if (fs.existsSync(template)) {
  const t = scanPath(template);
  check('project-structure template scans clean', t.findings.filter((f) => f.severity !== 'info').length === 0, JSON.stringify(t.findings, null, 1));
} else {
  console.log('skip project-structure template (not installed alongside)');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
