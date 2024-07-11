<script>
	import { Drawer } from "vaul-svelte";
	import { contact_request, chatId, turnsTileToken } from '$lib/store.js';
	import debounceAction from '$lib/debounce.js';
	import equal from 'fast-deep-equal';
	import debounce from "debounce";

	let loading = false;
	let saving = false;
	let verification_result = null;
	let contact_request_fetched = false;
	let contact_request_from_server = null;

	function verificationCodeCallback(code) {
		if(code) {
			loading = true;
			fetch(`https://backend.malipetek.dev/flows/trigger/bde4cad8-cc1c-405e-af26-1e8aca751cf7?chatId=${$chatId}&code=${code}&cf-token=${$turnsTileToken}`, {
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				}
			}).then(res => res.json()).then(res => {
				verification_result = res.success;
				if(res.success) {
					setTimeout(() => {
						contact_request_from_server.email_verified = true;
						$contact_request.email_verified = true;
					}, 3000);
				}
			}).finally(() => {
				loading = false;
			});
		}
	}
	
	$: if ($contact_request && !contact_request_fetched) {
		contact_request_fetched = true;
		contact_request_from_server = {...$contact_request};
	}

	const updateContactRequest = debounce(_updateContactRequest, 1000);

	$: if (contact_request_fetched && $contact_request && !equal(contact_request_from_server, $contact_request)) {
		console.log('changed contact request');
		updateContactRequest();
	}

	async function _updateContactRequest() {
		console.log('updating contact request');
		saving = true;
		await fetch(`https://backend.malipetek.dev/flows/trigger/50c60d55-593c-42e2-b40b-a022649d1deb?chatId=${$chatId}&cf-token=${$turnsTileToken}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
			},
			body: JSON.stringify($contact_request)
		}).then(res => {
			return res.json();
		}).then(res => {
			contact_request_from_server = {...$contact_request};
			if(res.email_invalidated) {
				verification_result = null;
				$contact_request.email_verified = false;
				contact_request_from_server.email_verified = false;
			}
		}).finally(() => {
			saving = false;
		})


	}
</script>

<Drawer.Root >
	{#if $contact_request}
		<Drawer.Trigger class="contact-request trigger z-50 absolute p-4 bottom-0 left-0 w-full gradient-bar">Contact Request 
		{#if $contact_request.email_verified != true}	
			(Email not verified)
		{/if}
		</Drawer.Trigger>
	{/if}
	<Drawer.Portal >
		<Drawer.Overlay class="contact-request fixed inset-0 bg-black/40" />
		<Drawer.Content 
					class="drawer-content contact-request fixed p-4 pt-24 bottom-0 left-0 right-0 mt-24 flex h-[96%] flex-col rounded-t-[10px] z-[890]"		
				>
				{#if saving}
				<div class="absolute w-full h-full bg-black bg-opacity-50 rounded-lg">
					<div role="status" class="absolute -translate-x-1/2 -translate-y-1/2 top-2/4 left-1/2">
						<svg aria-hidden="true" class="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/><path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/></svg>
						<span class="sr-only">Loading...</span>
					</div>
				</div>
				{/if}
				<label for="name-input" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Name</label>
				<div class="flex relative mb-6">
					<span class="inline-flex items-center px-3 text-sm text-gray-900 bg-gray-200 border rounded-e-0 border-gray-300 border-e-0 rounded-s-md dark:bg-gray-600 dark:text-gray-400 dark:border-gray-600">
						<svg class="w-4 h-4 text-gray-500 dark:text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
								<path d="M10 0a10 10 0 1 0 10 10A10.011 10.011 0 0 0 10 0Zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 13a8.949 8.949 0 0 1-4.951-1.488A3.987 3.987 0 0 1 9 13h2a3.987 3.987 0 0 1 3.951 3.512A8.949 8.949 0 0 1 10 18Z"/>
						</svg>
					</span>
					<input type="text" bind:value={$contact_request.name} id="name-input" class="rounded-none rounded-e-lg bg-gray-50 border text-gray-900 focus:ring-blue-500 focus:border-blue-500 block flex-1 min-w-0 w-full text-sm border-gray-300 p-2.5  dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="Name">
				</div>
				
				<label for="email" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Your Email</label>
				<div class="relative mb-6">
					<div class="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none">
						<svg class="w-4 h-4 text-gray-500 dark:text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 16">
								<path d="m10.036 8.278 9.258-7.79A1.979 1.979 0 0 0 18 0H2A1.987 1.987 0 0 0 .641.541l9.395 7.737Z"/>
								<path d="M11.241 9.817c-.36.275-.801.425-1.255.427-.428 0-.845-.138-1.187-.395L0 2.6V14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V2.5l-8.759 7.317Z"/>
						</svg>
					</div>
					<input type="text" bind:value={$contact_request.email} id="email" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full ps-10 p-2.5  dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="name@example.com">
				</div>

				<label for="message" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Your message</label>
				<textarea id="message" bind:value={$contact_request.message} rows="4" class="block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="Write your message here..."></textarea>

				{#if $contact_request.email_verified !== true}
				{#if verification_result === null}
						<div class="p-4 mb-4 text-sm text-yellow-800 rounded-lg bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300" role="alert">
							<span class="font-medium text-lg block">Verify your email</span> We have sent you an email with a code. Please enter the code to verify your email.
						</div>
					{:else if verification_result === false}
						<div class="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400" role="alert">
							<span class="font-medium text-lg block">Invalid code</span> The code you entered is invalid. Please try again.
						</div>
					{:else}
						<div class="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50 dark:bg-gray-800 dark:text-green-400" role="alert">
							<span class="font-medium text-lg block">Email verified</span> Your email has been verified successfully.
						</div>
					{/if}

				<label for="verification-code" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Verification Code</label>
				<div class="flex relative">
					<input type="text" use:debounceAction={{
						callback: verificationCodeCallback
					}} id="verification-code" class="rounded-lg bg-gray-50 border mb-6 text-gray-900 focus:ring-blue-500 focus:border-blue-500 block flex-1 min-w-0 w-full text-sm border-gray-300 p-2.5  dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 flex-grow-0 basis-40" placeholder="0A0A0A">
					{#if loading}
					<div class="absolute w-full h-full bg-black bg-opacity-50 rounded-lg">
						<div role="status" class="absolute -translate-x-1/2 -translate-y-1/2 top-2/4 left-1/2">
							<svg aria-hidden="true" class="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/><path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/></svg>
							<span class="sr-only">Loading...</span>
						</div>
					</div>
					{/if}
				</div>
				{/if}
			</Drawer.Content>
			<Drawer.Overlay />
		</Drawer.Portal>
</Drawer.Root>

<style>
:global(.drawer-content) {
	background-color: rgb(255 255 255 / var(--un-bg-opacity));
}
:global(.dark .drawer-content) {
	background-color: rgb(24 24 27 / var(--un-bg-opacity));
}
:global(.gradient-bar) {
	--un-gradient: 45deg,#fa709a,#fee140;
	background: linear-gradient(var(--un-gradient));
	color: inherit;
}

:global(.contact-request) {
    width: 100% !important;
  }
  @media (min-width: 950px) {
    :global(.contact-request) {
      width: calc(100% - 25vw) !important;
      left: 25vw !important;
    }
  }

	:global(.page-switcher) {
		display: none !important;
	}
</style>