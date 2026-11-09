// Build edition; public distributions never contain the SaaS marketing site.
export const edition = 'self-hosted' as 'self-hosted'|'operator';
export const selfHostedEdition = edition === 'self-hosted';
export const blockedSelfHostedRoutes = /^(?:billing(?:\/|$)|invoices(?:\/|$)|contracts?(?:\/|$)|self-hosted(?:\/|$)|pages(?:\/|$)|admin\/(?:plan(?:s)?|payments|company|contracts|einvoices|site|pages|marketing|analytics|self-hosted)(?:\/|$))/;
export const selfHostedRouteAllowed=(route:string)=>!blockedSelfHostedRoutes.test(route.replace(/^\//,''));
