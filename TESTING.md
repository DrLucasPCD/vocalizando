# Verificação

`npm test` verifica migração, combinação de históricos, correções, referências, vínculo de áudio, sincronização com um Storage simulado e erros de login/autorização.

Com Playwright instalado e o app em um servidor local, execute `node tests/browser-smoke.mjs`. `APP_URL`, `PLAYWRIGHT_MODULE` e `CHROME_PATH` permitem escolher o servidor, o módulo Playwright e um Chrome instalado. Use `BROWSER_ENGINE=webkit` para testar o motor WebKit. O teste usa uma voz sintética para verificar calibração e contagem, testa interrupções enquanto a permissão está pendente e gera capturas mobile/desktop em `/tmp/vocalizando-*.png`. Isso não valida reconhecimento de uma voz humana nem substitui Safari em um iPhone real.

## iPhone físico

Este fluxo ainda requer verificação em um aparelho físico:

1. Abrir o Netlify no Safari e como app instalado na tela inicial.
2. Entrar com Google, autorizar e sincronizar nos dois modos. Conferir o total de tentativas em outro aparelho.
3. Calibrar com silêncio e uma frase no volume habitual. Treinar com pausas curtas e longas; ajustar sensibilidade e intervalo se necessário.
4. Durante a escuta, bloquear a tela, trocar de app e interromper o microfone. Retornar e confirmar que os registros anteriores permanecem e a escuta só retoma por ação do usuário.
5. Guardar um áudio e verificar que a contagem não aumenta; excluir o áudio e confirmar que a tentativa permanece.
6. Comparar a mesma frase usando a mesma referência e pedir a um ouvinte que registre o que compreendeu sem ler a frase.

O teste real de Firebase exige conta autenticada, CORS configurado e publicação das regras atualizadas de `storage.rules`.
