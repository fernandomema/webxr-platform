<script lang="ts">
	const privacyEmail = 'support@kithin.app';
	const controllerName = 'Fernando Merino Marquez';
</script>

<svelte:head>
	<title>Privacy Policy · Kithin</title>
	<meta name="description" content="How Kithin handles account information, shared worlds, microphone audio, movement data and your privacy choices." />
	<link rel="canonical" href="https://kithin.app/privacy" />
</svelte:head>

<div class="privacy-page">
	<header>
		<a href="/" aria-label="Kithin home"><img src="/assets/kithin-logo.svg" alt="Kithin" width="112" height="32" /></a>
		<a href="/play">Open Kithin <span aria-hidden="true">↗</span></a>
	</header>
	<main id="main-content">
		<p class="eyebrow">Your information</p>
		<h1>Privacy Policy</h1>
		<p class="updated">Last updated: October 3, 2026</p>
		<p class="intro">Kithin lets you create and explore virtual worlds with other people, in a browser or on a compatible VR headset. This policy explains how information is handled across kithin.app and the Kithin Meta Quest application.</p>
		<aside aria-label="Privacy overview">
			<p><strong>Microphone access is optional.</strong> Voice is transmitted live through WebRTC. Kithin does not record or store voice conversations.</p>
			<p><strong>Shared spaces involve sharing information.</strong> Other participants receive your avatar movements, interactions and voice when enabled.</p>
			<p><strong>You can request deletion.</strong> Contact <a href="mailto:support@kithin.app">{privacyEmail}</a> about your account or personal information.</p>
		</aside>

		<section aria-labelledby="contact">
			<h2 id="contact">1. Who to contact</h2>
			<p>{controllerName}, based in Reus, Spain, is the data controller responsible for Kithin. For privacy questions, requests to access your information or requests to delete your account, email <a href="mailto:support@kithin.app">{privacyEmail}</a>. Include the email address associated with your account so we can identify it. Do not send your password. We may need to verify your identity before acting on a request.</p>
		</section>
		<section aria-labelledby="information">
			<h2 id="information">2. Information the service handles</h2>
			<ul>
				<li><strong>Account information:</strong> your name, email address, username, profile image when provided, account identifiers and authentication information. Password authentication uses a password hash. If you choose Discord sign-in, we receive the account information and authentication tokens needed for that connection.</li>
				<li><strong>Session and connection information:</strong> login sessions, expiry times, IP addresses and browser or device information used for authentication, network connections and service security. Hosting infrastructure may also process request logs.</li>
				<li><strong>Content you create or save:</strong> worlds, scene data, objects, uploaded models, images and audio files, previews, inventory folders, publications and records of items acquired through the marketplace. Uploaded audio files are separate from live microphone audio.</li>
				<li><strong>Multiplayer information:</strong> room and participant identifiers, display names, connection negotiation messages and network addresses, avatar positions, head and hand poses, controller input and world interactions needed to synchronise a shared session.</li>
				<li><strong>Support communications:</strong> information you choose to send when contacting us.</li>
			</ul>
		</section>
		<section aria-labelledby="permissions">
			<h2 id="permissions">3. Microphone and headset permissions</h2>
			<p>The Android permission <code>RECORD_AUDIO</code> and your browser's microphone permission allow live voice communication in shared worlds. With permission, microphone audio is sent through WebRTC to connected participants, including the participant hosting the world. Spatial playback reflects participants' positions. You can deny or revoke microphone access in your browser or device settings and continue using Kithin without transmitting your voice.</p>
			<p>On supported headsets, WebXR and hand tracking provide head, controller and hand movement data for rendering, avatar animation and interaction. Movement needed for the shared experience is transmitted to connected participants. Kithin does not use these movements to identify you biometrically.</p>
			<p>Kithin does not record live voice conversations or store live headset and hand tracking streams on its servers. Other participants can hear what you transmit and may use tools outside Kithin to record it. Avoid sharing sensitive information in a session.</p>
			<p>The Quest package opens the same Kithin web service. The current Kithin implementation does not integrate Meta account identifiers, Meta in-app purchases or a separate third-party diagnostics SDK. Android application backups are disabled by the packaging process. Meta and the browser may independently process platform information under their own policies.</p>
		</section>
		<section aria-labelledby="purposes">
			<h2 id="purposes">4. Why information is used</h2>
			<p>Information is used to create and authenticate accounts, connect participants, run shared worlds, store and publish the content you choose, maintain your inventory, respond to requests and protect the service against abuse.</p>
			<p>Where the GDPR applies, we process account information, saved content and the connection and movement data necessary to deliver the features you request to perform our service agreement with you. We rely on legitimate interests in protecting users and the service for proportionate security and abuse prevention, and on legal obligations when processing is required by law. Browser and headset permissions control technical access to your microphone and tracking features; they do not by themselves establish a legal basis for every use of that information. Where a use requires your consent, you may withdraw it at any time by contacting us, and you can stop microphone or tracking access through device or browser settings. Withdrawal does not affect the lawfulness of processing before it occurred.</p>
			<p>Account details are required to create and authenticate an account. Without them, account features are unavailable. Microphone access and optional AI features are voluntary. Movement and connection information are necessary for the interactive multiplayer features you choose to use. Kithin does not use your personal information for automated decisions that produce legal or similarly significant effects.</p>
		</section>
		<section aria-labelledby="sharing">
			<h2 id="sharing">5. Sharing and external services</h2>
			<p>Connected participants receive the information needed to take part in the same world. WebRTC connections can expose network addresses to peers. Google STUN (stun.l.google.com) processes network information, including your IP address, to help devices connect. STUN discovers connection addresses; it does not carry your voice conversations or shared world content. Content you publish or share can be accessed by its intended audience, and recipients may keep copies.</p>
			<p>Bytehosting provides the VPS infrastructure used to operate Kithin. Bytehosting states that its infrastructure is located in Frankfurt, Germany. Infrastructure providers process information needed to host the website, database and uploaded files. Google Fonts receives your IP address and browser request information when the website loads its fonts. Discord processes sign-in when you choose that option. Your browser and Meta Quest platform also process information under their own privacy policies.</p>
			<p>Worlds can contain external links, media or interactive content. Opening or loading them can send information such as your IP address to the relevant external service.</p>
			<p>If you use the optional Studio AI assistant, your prompts, conversation and scene information provided to the assistant are sent to the AI provider you select. For supported cloud providers, requests and the credential you supply pass through Kithin's server to that provider. Supported providers include OpenAI, Anthropic (Claude), OpenCode and OpenRouter. FreeLLMAPI, custom and local endpoints connect directly from your browser. API keys you enter and provider preferences are saved in your browser's local storage. Clear the API key field for a provider to remove its saved key. Kithin does not save these pasted keys in its database. Provider retention and use are governed by that provider's terms and privacy policy. Do not include information you do not want to share with that provider.</p>
			<p>Kithin currently has no advertising, third-party analytics, payment processing or third-party crash reporting integrations. We do not sell personal information or use microphone audio or movement data for targeted advertising. Information may be disclosed when required by law or necessary to protect the service and its users.</p>
		</section>
		<section aria-labelledby="storage">
			<h2 id="storage">6. Cookies, local storage and retention</h2>
			<p>Authentication cookies keep you signed in. A language cookie and browser storage remember preferences. Local storage and IndexedDB can hold settings, drafts, downloaded assets and local inventory. You can clear these through browser settings; doing so may sign you out or remove local content that has not been saved elsewhere.</p>
			<p>Account information and saved content are kept while your account remains open and are reviewed for deletion when you close it. Our retention limits are 30 days for routine access and security logs, seven days after expiry for authentication sessions and verification records, 30 days after a world session ends for its hosting history, and 12 months after resolution for support correspondence. Records needed for a specific security incident, legal obligation or legal claim may be retained for the necessary period, with access restricted. Live voice and movement streams are not archived by Kithin.</p>
			<p>To request account and personal data deletion, email support using the address associated with your account where possible. We verify your request using only the information reasonably needed, delete or anonymise applicable account records and content, and confirm the outcome. We aim to complete ordinary requests within one month of receipt; statutory exceptions and permitted extensions are explained in section 7. Some information may need to be retained to meet legal obligations or resolve disputes. Shared files may remain referenced by other users' content. This does not remove your right to request erasure of personal information contained in those files; we assess such requests under applicable law. Copies independently held by other participants are outside Kithin's control. Clearing browser storage does not delete your cloud account.</p>
			<p>Where recovery backups are maintained, our retention limit is 30 days from creation. Deleted information may remain in an isolated backup until it expires and is not used for ordinary service operations. If a backup is restored, deletion requests must be reapplied before the restored data returns to ordinary use. These limits concern copies under Kithin's control; external providers apply their own disclosed retention rules.</p>
		</section>
		<section aria-labelledby="rights">
			<h2 id="rights">7. Your choices and rights</h2>
			<p>You can choose whether to create an account, grant microphone access, upload content, publish worlds or use optional AI features. Review permissions in your browser and headset settings.</p>
			<p>Depending on applicable law, you may request access, correction, deletion, a portable copy of your information, restriction of processing or object to processing. Contact <a href="mailto:support@kithin.app">{privacyEmail}</a> to exercise these rights. Where the GDPR applies, we respond without undue delay and within one month of receiving your request. If complexity or the number of requests requires an extension of up to two further months, we will explain the reason within the first month. Requests are normally free; applicable law allows a reasonable fee or refusal for manifestly unfounded or excessive requests. You can also complain to your local data protection authority, including the <a href="https://www.aepd.es/">Spanish Data Protection Agency (AEPD)</a>.</p>
		</section>
		<section aria-labelledby="international">
			<h2 id="international">8. Security and international processing</h2>
			<p>The website uses HTTPS, and WebRTC encrypts data in transit. Authentication and access controls restrict access to account content. No online service can guarantee absolute security.</p>
			<p>Bytehosting reports hosting infrastructure in Germany, within the European Economic Area (EEA). Google services, Discord, Meta, the AI provider you choose and participants in other countries may process information outside the EEA. The countries involved depend on the provider and the participants you connect to. For transfers for which Kithin is responsible, an applicable European Commission adequacy decision or appropriate safeguards, such as standard contractual clauses, are required unless a specific lawful exception applies. Contact us to request the arrangements and a copy of the safeguards applicable to a particular transfer. This policy does not mean that every external service processes information only in Europe.</p>
		</section>
		<section aria-labelledby="changes">
			<h2 id="changes">9. Changes to this policy</h2>
			<p>Updates will appear on this page with a revised date. Material changes will be communicated where required by law. For questions about this policy, contact <a href="mailto:support@kithin.app">{privacyEmail}</a>.</p>
		</section>
	</main>
	<footer><a href="/">Kithin</a><span>Privacy Policy</span><a href="mailto:support@kithin.app">Contact</a></footer>
</div>

<style>
	.privacy-page { max-width: 1120px; margin: auto; padding: 0 24px; }
	header, footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 28px 0; }
	header { border-bottom: 1px solid #ffffff18; }
	header img { display: block; object-fit: contain; }
	header a, footer a { color: #f4f1ea; text-decoration: none; }
	main { max-width: 760px; margin: 72px auto 80px; }
	.eyebrow { color: #8ff0cf; font-size: .75rem; text-transform: uppercase; letter-spacing: .18em; }
	h1, h2 { font-family: var(--font-display); color: #f4f1ea; }
	h1 { font-size: clamp(2.5rem, 8vw, 4.5rem); line-height: 1.08; letter-spacing: -.04em; margin: 16px 0; }
	.updated { color: #b6b2bf; font-size: .875rem; }
	.intro { font-size: 1.125rem; margin-top: 32px; }
	p, li { color: #d0cdd7; line-height: 1.8; }
	p { margin: 14px 0; }
	aside { background: #13131f; border: 1px solid #8ff0cf35; border-radius: 20px; padding: 16px 24px; margin: 32px 0 48px; }
	section { margin-top: 40px; }
	h2 { font-size: 1.4rem; line-height: 1.35; margin-bottom: 16px; }
	ul { padding-left: 24px; }
	li { margin: 12px 0; }
	strong { color: #f4f1ea; font-weight: 600; }
	a { color: #8ff0cf; text-underline-offset: 4px; overflow-wrap: anywhere; }
	a:hover { text-decoration: underline; }
	a:focus-visible { outline: 2px solid #8ff0cf; outline-offset: 5px; }
	code { font-size: .875em; overflow-wrap: anywhere; }
	footer { border-top: 1px solid #ffffff18; color: #b6b2bf; font-size: .875rem; flex-wrap: wrap; }
	@media (max-width: 600px) { main { margin-top: 48px; } aside { padding: 12px 18px; } }
</style>
