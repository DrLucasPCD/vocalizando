# Sincronização Firebase

O site usa o projeto `vocalizando-b98c7`. Nenhum áudio é enviado antes de entrar com Google, marcar a autorização e tocar em **Sincronizar agora**. O modelo treinado fica neste aparelho; os exemplos são sincronizados para que você possa treiná-lo no outro.

## Ativar uma vez no console

1. Em **Firebase Authentication > Sign-in method**, ative o provedor **Google**.
2. Em **Authentication > Settings > Authorized domains**, adicione o domínio HTTPS exato do seu site Netlify. O login por popup também precisa estar liberado pelo navegador.
3. Confirme que o bucket `vocalizando-b98c7.firebasestorage.app` existe no plano Blaze.
4. Em **Storage > Rules**, examine as regras atuais antes de substituí-las. Se o bucket é usado somente pelo Vocalizando, publique o conteúdo de `storage.rules`. Se outros aplicativos usam o mesmo bucket, incorpore os três caminhos `/users/{userId}/...` às regras existentes; publicar este arquivo inteiro sobrescreve as regras atuais.
5. Para permitir o download dos exemplos e áudios pelo navegador, configure CORS no bucket com o arquivo `firebase-cors.json`:

   ```sh
   gcloud storage buckets update gs://vocalizando-b98c7.firebasestorage.app --cors-file=firebase-cors.json
   ```

   O arquivo usa origem `*` somente para requisições `GET`, conforme o exemplo oficial do Firebase. CORS não substitui as regras de autenticação. Você pode trocar `*` pelo domínio exato do Netlify antes de aplicar.

## Uso

No primeiro aparelho, entre com a conta Google, marque a autorização e sincronize. No segundo, entre com a mesma conta e sincronize. Depois de baixar os exemplos de Tá Rá Lá e III, toque em **Treinar modelo** nesse aparelho. Gravações do treino funcional e dos trava-línguas também serão recebidas. Uma exclusão local é aplicada na nuvem na próxima sincronização. **Apagar da nuvem** não apaga os dados locais; sincronizar novamente poderá reenviá-los.

As notas de trava-língua continuam sendo uma estimativa da transcrição do navegador, não uma avaliação clínica. A avaliação do ouvinte fica separada. Histórico e notas do app ainda usam o backup JSON do navegador; esta sincronização cobre exemplos e gravações de áudio.
