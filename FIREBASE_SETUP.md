# Sincronização Firebase

O site usa o projeto `vocalizando-b98c7`. Nenhum áudio é enviado antes de entrar com Google, marcar a autorização e tocar em **Sincronizar agora**. O modelo treinado fica neste aparelho; os exemplos são sincronizados para que você possa treiná-lo no outro.

## Ativar uma vez no console

1. Em **Firebase Authentication > Sign-in method**, ative o provedor **Google**.
2. Em **Authentication > Settings > Authorized domains**, adicione o domínio HTTPS exato do seu site Netlify. O login por popup também precisa estar liberado pelo navegador.
3. Confirme que o bucket `vocalizando-b98c7.firebasestorage.app` existe no plano Blaze.
4. Em **Storage > Rules**, examine as regras atuais antes de substituí-las. Se o bucket é usado somente pelo Vocalizando, publique o conteúdo de `storage.rules`. Se outros aplicativos usam o mesmo bucket, incorpore os caminhos `/users/{userId}/...` às regras existentes; publicar este arquivo inteiro sobrescreve as regras atuais. A atualização de outubro acrescenta `/users/{userId}/history/{deviceId}` para o histórico completo. Sem essa regra, os áudios continuam sincronizando e o app informa que o histórico não foi enviado.
5. Para permitir o download dos exemplos e áudios pelo navegador, configure CORS no bucket com o arquivo `firebase-cors.json`:

   ```sh
   gcloud storage buckets update gs://vocalizando-b98c7.firebasestorage.app --cors-file=firebase-cors.json
   ```

   O arquivo usa origem `*` somente para requisições `GET`, conforme o exemplo oficial do Firebase. CORS não substitui as regras de autenticação. Você pode trocar `*` pelo domínio exato do Netlify antes de aplicar.

## Uso

No primeiro aparelho, entre com a conta Google, marque a autorização e sincronize. No segundo, entre com a mesma conta e sincronize. Depois de baixar os exemplos de Tá Rá Lá e III, toque em **Treinar modelo** nesse aparelho. Histórico, avaliações, referências acústicas, palavras pessoais, frases e gravações serão recebidos. Sincronize novamente no primeiro aparelho para receber as novas tentativas do segundo.

Cada aparelho publica uma cópia identificada do histórico. Tentativas novas têm IDs únicos, e correções deixam marcas de exclusão que impedem o retorno de registros antigos. Ao alterar a mesma avaliação nos dois aparelhos, prevalece a alteração mais recente; referências de frases diferentes são combinadas. O histórico antigo de Tá Rá Lá/III só tinha totais: a migração conserva esses totais, mas não reconstrói áudios ou horários individuais. Backups idênticos usam a mesma identidade histórica para evitar duplicação.

Uma exclusão de áudio local é aplicada na nuvem na próxima sincronização e não apaga a tentativa do histórico. **Apagar da nuvem** não apaga os dados locais; sincronizar novamente poderá reenviá-los. Os dados locais ficam vinculados à primeira conta usada para sincronizar; para usar outra conta neste navegador, exporte e apague os dados locais primeiro.

As notas de trava-língua medem correspondência da transcrição. A nota funcional compara características acústicas com uma referência identificada da mesma frase; não há nota para propostas de resposta livre ou áudio com qualidade insuficiente. Comparações entre tentativas exigem a mesma frase, referência e aparelho. O ajuste de sensibilidade e pausas é sincronizado; a calibração de ruído e volume permanece local porque depende do microfone.
