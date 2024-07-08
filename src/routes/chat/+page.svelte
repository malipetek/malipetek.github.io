<script>
  import { onMount } from "svelte";
  import RequestEditor from "../../lib/components/RequestEditor.svelte";
  let chatbot;
  const chatflowid = "e50f5edc-6aac-471b-8cf9-52bd114bc8e4";
  let contact_request = null;
  let chatId = null;
  $: if (contact_request) {
    console.log({ contact_request });
  }

  const getChatId = () => {
    return JSON.parse(localStorage[`${chatflowid}_EXTERNAL`]).chatId;
  }
  onMount(async () => {
    const {default: Chatbot} = await import("flowise-embed/dist/web.js");

    Chatbot.initFull({
      chatflowid,
      apiHost: "https://flowise.malipetek.dev",
      observersConfig: {
        // The bot message stack has changed
        observeMessages: (messages) => {
          console.log({ messages });
        },
        // The bot loading signal changed
        observeLoading: async (loading) => {
          if(!loading && !contact_request) {
            if(!chatId) chatId = getChatId();
            const res = await fetch(`https://backend.malipetek.dev/flows/trigger/1b863933-0d16-4e18-9556-4c900c435ee2?chatId=${chatId}`, {
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              }
            });
            const reqs = await res.json();
            [contact_request] = reqs;
          }
        }
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

<flowise-fullchatbot bind:this={chatbot}></flowise-fullchatbot>
<RequestEditor {contact_request} />

<style>
  flowise-fullchatbot {
    position: absolute;
    bottom: 0;
  }
  :global(.last-update) {
    display: none;
  }
</style>