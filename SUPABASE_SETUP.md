# Supabase no Vocalizando

A integração substitui o Firebase Storage. Nenhum dado é enviado sem login, autorização e um toque em **Sincronizar agora**. Os exercícios e os dados locais continuam funcionando sem configurar a nuvem.

## Projeto configurado

Projeto `Vocalizando` (`fntktcakllzjtkmwcuzp`) na organização LVSA, região São Paulo. A URL e a chave pública estão em `supabase-config.js`. O bucket privado e as quatro políticas foram publicados em 11/10/2026. A permissão de execução pública da função padrão `public.rls_auto_enable()` foi revogada, sem desativar o event trigger que habilita RLS. A auditoria de segurança retornou sem avisos.

O login Google ainda precisa ser habilitado no painel. O app consulta o estado real do provedor antes de redirecionar e informa quando ele está desativado.

Para este projeto, configure:

- Supabase Authentication > URL Configuration: Site URL `https://vocalizando.netlify.app`; Redirect URLs `https://vocalizando.netlify.app/` e `https://vocalizando.netlify.app/Index.html`.
- Google Cloud > APIs & Services > Credentials: cliente OAuth do tipo Web, com redirect URI `https://fntktcakllzjtkmwcuzp.supabase.co/auth/v1/callback`. É possível usar um cliente existente, mantendo os redirects que o Firebase ainda utiliza.
- Supabase Authentication > Sign In / Providers > Google: habilite o provedor e informe o Client ID e o Client Secret somente no painel. Se o app Google estiver em modo de teste, inclua seu e-mail como usuário de teste.

### Se ainda nao tem as credenciais Google

1. Abra [Google Auth Platform](https://console.cloud.google.com/auth/overview). Selecione seu projeto Google Cloud existente ou crie um projeto para o Vocalizando.
2. Em **Branding**, configure o nome Vocalizando, seu e-mail de suporte e de contato. Em **Audience**, use **External** quando a conta for pessoal; enquanto estiver em teste, adicione seu e-mail em **Test users**.
3. Em **Data Access**, mantenha apenas `openid`, `userinfo.email` e `userinfo.profile` para identificar a conta. Nao e necessario dar acesso ao Drive ou a outros dados Google.
4. Em **Clients > Create client**, escolha **Web application**. Em **Authorized JavaScript origins**, adicione `https://vocalizando.netlify.app`. Em **Authorized redirect URIs**, adicione `https://fntktcakllzjtkmwcuzp.supabase.co/auth/v1/callback`.
5. Depois de criar, coloque **Client ID** e **Client Secret** somente em [Supabase > Authentication > Providers > Google](https://supabase.com/dashboard/project/fntktcakllzjtkmwcuzp/auth/providers). Ative o provedor e salve. Nao envie o Client Secret no chat nem coloque no GitHub.
6. Em [Supabase > URL Configuration](https://supabase.com/dashboard/project/fntktcakllzjtkmwcuzp/auth/url-configuration), configure as URLs do site listadas acima. Volte ao app, recarregue a pagina e teste **Entrar com Google**.

As regras foram verificadas pelo catálogo e por 20 testes das expressões de autorização no banco. A transferência autenticada de arquivos em dois aparelhos e o OAuth real ainda estão pendentes; não há gravações de teste ou usuários artificiais criados no projeto.

## Ativar o projeto gratuito

1. Crie um projeto **Free** em https://supabase.com/dashboard. Não é necessário contratar o Pro para esta integração. O plano tem cotas e pode pausar o projeto por inatividade; confira https://supabase.com/pricing.
2. Abra **SQL Editor** e execute `supabase-setup.sql`. Ele cria o bucket **privado** `vocalizando-private` e quatro políticas que restringem leitura, listagem, gravação e exclusão ao usuário autenticado. Em um projeto existente, examine antes todas as políticas de `storage.objects`: políticas permissivas antigas podem ampliar o acesso, pois são combinadas por OR. O script não remove políticas de outros apps.
3. Em **Settings > API Keys**, obtenha a chave **publishable** (ou a chave legada **anon**). Em **Settings > Data API**, obtenha a Project URL. Preencha `url` e `publicKey` em `supabase-config.js`. Nunca coloque chaves secretas ou `service_role` no site, no GitHub ou no chat.
4. Em **Authentication > URL Configuration**, configure Site URL como `https://vocalizando.netlify.app` e adicione às Redirect URLs `https://vocalizando.netlify.app/` e `https://vocalizando.netlify.app/Index.html`. Para testes locais, adicione `http://localhost:8765/Index.html`.
5. Em **Authentication > Sign In / Providers > Google**, ative o Google e configure seu Client ID e Client Secret do Google Cloud. No cliente OAuth do Google, adicione o callback exibido pelo Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`) como Authorized redirect URI. Se o consentimento OAuth estiver em teste, adicione seu e-mail aos usuários de teste. O Client Secret fica somente no painel Supabase, nunca no app.
6. Publique os arquivos do app. O SDK Supabase já está incluído em `vendor/supabase.js`, compilado com `npm run build:cloud`; não depende de carregar uma CDN em cada acesso.

Referências oficiais: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls), [políticas privadas](https://supabase.com/docs/guides/storage/security/access-control).

## Troca do Firebase

O histórico, as referências, a calibração e os áudios locais não são apagados. O app não lê nem apaga arquivos que existam apenas no Firebase. Antes da troca, baixe esses arquivos no aparelho pela versão antiga ou guarde um backup. As mesmas contas Google recebem identificadores diferentes nos dois serviços. Na primeira sincronização Supabase, um aparelho vinculado ao Firebase pede confirmação da transferência dos dados locais. Depois disso, os dados ficam vinculados à primeira conta Supabase usada naquele projeto. Não se baseia somente na coincidência de e-mails para autorizar a transferência.

No segundo aparelho, entre com a mesma conta Google e sincronize. Os exemplos de Tá Rá Lá e III são transferidos; o treinamento do modelo precisa ser executado em cada aparelho. A calibração do microfone permanece local.

## Limites e exclusão

Há limite de 10 MB por gravação/histórico e 40 MB para exemplos de treinamento. As cotas de armazenamento e tráfego do plano Free também se aplicam. Ao atingir uma cota, o app mostra a falha e mantém os dados locais; não ativa plano pago automaticamente. Não mude o bucket para público para corrigir um erro.

Uma exclusão local de gravação é transmitida na próxima sincronização e não apaga a tentativa do histórico. **Apagar da nuvem** mantém os dados locais; uma nova sincronização pode reenviá-los. Sair da conta também não apaga os dados locais.

## Verificação antes de usar com gravações reais

1. Sincronize tentativas e uma gravação curta em dois aparelhos, duas vezes, sem duplicar contagens.
2. Altere uma avaliação no segundo aparelho e confirme que chega ao primeiro.
3. Exclua um áudio e confira que não volta após sincronizar novamente.
4. Com duas contas de teste, confirme que a conta B não consegue listar, baixar, sobrescrever ou excluir o caminho da conta A; sem login, o arquivo também não deve ser acessível. Confira as políticas existentes, não apenas o atributo privado do bucket.
5. Teste o login e o retorno ao app instalado no iPhone. O login usa redirecionamento e PKCE, sem depender de pop-ups. Se o retorno abrir outro navegador, use o mesmo navegador onde iniciou o login.

Os testes automáticos locais usam um Supabase simulado. Não substituem a verificação das políticas e do OAuth no projeto real.
