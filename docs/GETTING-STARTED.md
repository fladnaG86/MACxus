# Getting started / Primi passi

**[English](#english)** · **[Italiano](#italiano)**

## English

These steps apply to releases that include the bundled Apple Silicon backend.
The betas through `0.3.11-mac.3` required a local backend build; choose a release
whose notes say the backend is included. Developers building from source can follow
[the maintainer guide](MAC-BACKEND.md).

### 1. Check your Mac

MACxus needs an Apple Silicon Mac (M1 or later), Rosetta 2 and CrossOver 26.x in
`/Applications`. CrossOver is paid software with a free trial and runs natively;
install Rosetta explicitly for the Windows games. Open **Terminal**, paste this
command and press Return (it accepts Apple's Rosetta license):

```sh
softwareupdate --install-rosetta --agree-to-license
```

### 2. Install MACxus

Download the Apple Silicon `.dmg` from
[Releases](https://github.com/fladnaG86/MACxus/releases), open it, and drag MACxus
to Applications. The beta app is unsigned. Try opening it once, then go to
**System Settings → Privacy & Security → Open Anyway**. Alternatively, open
Terminal and run this command for the app you just installed:

```sh
xattr -dr com.apple.quarantine /Applications/MACxus.app
```

The Xodus backend is included and becomes ready automatically. **You do not need
Homebrew, Git, Rust or protoc**, and you do not need to create a signing certificate.
If MACxus says its bundled backend cannot be verified, reinstall the app from the
release instead of installing developer tools.

### 3. Install the runtime and sign in

In **Settings**, choose **Install Nexus runtime** if no runtime is selected.
MACxus verifies and installs it. Optionally install the **Highball** Wine engine
for supported D3D12/Unreal games; CrossOver remains the default.

Choose **Sign in with Xodus**. Sign-in uses MACxus's own window: Chrome is not
needed. Use your Microsoft password, a code or the Authenticator app. Passkeys
are not supported on macOS yet; choose **Other ways to sign in** if Microsoft asks
for one. You need to own the game or have an appropriate PC Game Pass subscription.

### 4. Install a game

Choose a game in **My Library** or **Store**, then choose the drive/folder for it.
APFS and Mac OS Extended drives work directly. For exFAT/FAT/NTFS drives, use
**Create APFS image**. Wait for installation to finish, then press **Play**.
Not every game works; kernel anti-cheat games are unsupported. See the README's
compatibility notes.

### Updates and help

Replace the app with the new `.dmg` version. Its included backend updates with
the app; there is no normal user rebuild step. Your library and settings remain
in your profile. **Settings → Language** switches between English and Italian.
For a problem, enable game logging temporarily and review the log before sharing
it in a [MACxus issue](https://github.com/fladnaG86/MACxus/issues). Never share account
tokens, Keychain contents, game files or saves.

## Italiano

Questi passi valgono per le release con il backend Apple Silicon incluso.
Le beta fino alla `0.3.11-mac.3` richiedevano la compilazione locale: scegli una
release le cui note indicano il backend incluso. Per compilare dal sorgente,
consulta [la guida per sviluppatori](MAC-BACKEND.md).

### 1. Controlla il Mac

Servono un Mac Apple Silicon (M1 o successivo), Rosetta 2 e CrossOver 26.x in
`/Applications`. CrossOver è a pagamento, con una prova gratuita, ed è un'app
nativa: installa esplicitamente Rosetta per i giochi Windows. Apri **Terminale**,
incolla il comando e premi Invio (accetta la licenza Rosetta di Apple):

```sh
softwareupdate --install-rosetta --agree-to-license
```

### 2. Installa MACxus

Scarica il `.dmg` Apple Silicon dalle
[release](https://github.com/fladnaG86/MACxus/releases), aprilo e trascina MACxus in
Applicazioni. La beta non è firmata. Prova ad aprirla una volta, poi vai in
**Impostazioni di Sistema → Privacy e sicurezza → Apri comunque**. In alternativa,
apri Terminale ed esegui questo comando per l'app appena installata:

```sh
xattr -dr com.apple.quarantine /Applications/MACxus.app
```

Il backend Xodus è incluso e diventa pronto automaticamente. **Non servono
Homebrew, Git, Rust o protoc**, né un certificato di firma locale. Se il backend
incluso non supera la verifica, reinstalla l'app dalla release invece di installare
strumenti di sviluppo.

### 3. Installa il runtime e accedi

In **Impostazioni**, scegli **Installa runtime Nexus** se non è selezionato alcun
runtime. MACxus lo verifica e lo installa. Puoi anche installare il motore Wine
**Highball** per i giochi D3D12/Unreal supportati; CrossOver resta il predefinito.

Scegli **Accedi con Xodus**. L'accesso avviene nella finestra di MACxus: Chrome non
serve. Usa la password Microsoft, un codice o l'app Authenticator. Le passkey non
sono ancora supportate su macOS: scegli **Altri modi per accedere** se Microsoft
ne richiede una. Devi possedere il gioco o avere un abbonamento PC Game Pass adatto.

### 4. Installa un gioco

Scegli un gioco da **La mia libreria** o **Negozio**, poi il disco e la cartella.
I dischi APFS e Mac OS esteso funzionano direttamente. Per exFAT/FAT/NTFS usa
**Crea immagine APFS**. Attendi la fine dell'installazione e premi **Gioca**.
Non tutti i giochi funzionano; gli anti-cheat a livello kernel non sono supportati.
Consulta le note di compatibilità nel README.

### Aggiornamenti e aiuto

Sostituisci l'app con la nuova versione `.dmg`. Il backend incluso si aggiorna
insieme all'app: normalmente non devi ricompilarlo. Libreria e impostazioni restano
nel tuo profilo. **Impostazioni → Lingua** permette di scegliere inglese o italiano.
Per un problema, attiva temporaneamente i log e rileggili prima di allegarli a una
[issue MACxus](https://github.com/fladnaG86/MACxus/issues). Non condividere token,
contenuti del Portachiavi, file dei giochi o salvataggi.
