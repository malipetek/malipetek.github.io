<script>
  import { onMount } from "svelte";
  import RequestEditor from "../../lib/components/RequestEditor.svelte";
  import { turnstile } from '@svelte-put/cloudflare-turnstile';
  import { contact_request, chatId, turnsTileToken } from '$lib/store.js';
  let chatLoading = false;
  let showturnstile = false;

  $: $turnsTileToken, console.log('$turnsTileToken', $turnsTileToken);
  $: chatLoading, console.log('chatLoading', chatLoading);
  $: $contact_request, console.log('$contact_request', $contact_request);
  $: $chatId, console.log('$chatId', $chatId);

  $: if($turnsTileToken && !chatLoading && !$contact_request) {
    getContactRequest();
  }
  
  async function getContactRequest() {
    if(!$chatId) $chatId = getChatId();
    const res = await fetch(`https://backend.malipetek.dev/flows/trigger/1b863933-0d16-4e18-9556-4c900c435ee2?chatId=${$chatId}&cf-token=${$turnsTileToken}`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    });
    const reqs = await res.json();
    [$contact_request] = reqs;
  }

  const chatflowid = "e50f5edc-6aac-471b-8cf9-52bd114bc8e4";
  
  const getChatId = () => {
    try{
      return JSON.parse(localStorage[`${chatflowid}_EXTERNAL`]).chatId;
    } catch(e) {
      return null;
    }
  }

  onMount(async () => {
    const {default: Chatbot} = await import("flowise-embed/dist/web.js");

    Chatbot.initFull({
      chatflowid,
      apiHost: "https://flowise.malipetek.dev",
      observersConfig: {
        observeLoading: (loading) => chatLoading = loading,
      },
      theme: {
        button: {
          backgroundColor: 'transparent',
          right: 20,
          bottom: 20,
          size: 48, // small | medium | large | number
          dragAndDrop: true,
          iconColor: 'white',
          customIconSrc: 'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/svg/google-messages.svg',
        },
      tooltip: {
        showTooltip: false,
        tooltipMessage: 'Hi There 👋!',
        tooltipBackgroundColor: 'black',
        tooltipTextColor: 'white',
        tooltipFontSize: 16,
      },
      chatWindow: {
        showTitle: false,
        showAgentMessages: false,
        title: 'Muhammet\'s Bot',
        titleAvatarSrc: 'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/svg/google-messages.svg',
        // welcomeMessage: 'Hello, I am Muhammet, how can I help you?',
        errorMessage: 'This is a custom error message',
        backgroundColor: 'transparent',
        height: null,
        width: '100%',
        fontSize: 16,
        botMessage: {
          backgroundColor: 'rgba(59, 129, 246, 0.3)',
          textColor: 'inherit',
          showAvatar: true,
          avatarSrc: '/me.webp',
        },
        userMessage: {
          backgroundColor: 'rgba(59, 129, 246, 0.1)',
          textColor: 'inherit',
          showAvatar: true,
          avatarSrc: 'https://raw.githubusercontent.com/zahidkhawaja/langchain-chat-nextjs/main/public/usericon.png',
        },
        textInput: {
          placeholder: 'Type your question',
          backgroundColor: 'rgba(59, 129, 246, 0.1)',
          textColor: 'inherit',
          sendButtonColor: '#3B81F6',
          autoFocus: true, // If not used, autofocus is disabled on mobile and enabled on desktop. true enables it on both, false disables it on both.
          sendMessageSound: false,
          // sendSoundLocation: "send_message.mp3", // If this is not used, the default sound effect will be played if sendSoundMessage is true.
          receiveMessageSound: false,
          // receiveSoundLocation: "receive_message.mp3", // If this is not used, the default sound effect will be played if receiveSoundMessage is true.
        },
        feedback: {
          color: '#ddd',
        },
        footer: {
          textColor: 'inherit',
          text: 'Powered by',
          company: 'Flowise & Groq & Llama3-70b & Directus',
          companyLink: '/chatbotstack',
        },
      },
    },
    });
  });
</script>

<!-- Main modal -->
<div id="default-modal" tabindex="-1" aria-hidden="true"
  class:hidden={!showturnstile}
  class="overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
  >
  <div class="relative p-4 top-1/3 md:left-1/3 w-full max-w-2xl max-h-full">
      <!-- Modal content -->
      <div class="relative bg-white rounded-lg shadow dark:bg-gray-700">
          <!-- Modal body -->
          <div class="p-4 md:p-5 space-y-4">
            <div
              class="my-4"
              use:turnstile
              turnstile-sitekey="0x4AAAAAAAewEfh8oJlivkPx"
              turnstile-sitekey-t="3x00000000000000000000FF"
              turnstile-theme="dark"
              turnstile-size="normal"
              turnstile-appearance="interaction-only"
              on:turnstile:before-interactive={() => showturnstile = true}
              on:turnstile:error={() => showturnstile = true}
              on:turnstile:expired={() => showturnstile = true}
              on:turnstile:timeout={() => showturnstile = true}
              on:turnstile={(e) => {
                $turnsTileToken = e.detail.token;
                showturnstile = false;
                }}
            />
          </div>

      </div>
  </div>
</div>

<RequestEditor {contact_request} />
<flowise-fullchatbot ></flowise-fullchatbot>

<style>
  flowise-fullchatbot {
    position: absolute;
    bottom: 0;
  }
  :global(.contact-request.trigger) + flowise-fullchatbot {
    bottom: 56px;
  }
  :global(.last-update) {
    display: none;
  }
  
  :global(.content) {
    width: 100% !important;
  }
  @media (min-width: 950px) {
    :global(.content) {
      width: calc(100% - 55vw) !important;
    }
  }
</style>