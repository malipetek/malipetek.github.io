globalThis.process ??= {}; globalThis.process.env ??= {};
import { c as createComponent, r as renderComponent, a as renderTemplate, u as unescapeHTML } from '../../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Legal } from '../../chunks/Legal_BO_YTNzy.mjs';
export { renderers } from '../../renderers.mjs';

const html = () => "<h1 id=\"pdf-extractor-terms-of-service\">PDF Extractor Terms of Service</h1>\n<p><strong>Effective Date</strong>: January 3, 2026</p>\n<h2 id=\"introduction\">Introduction</h2>\n<p>Welcome to PDF Extractor, a macOS application designed to extract images and content from PDF files. These Terms of Service govern your use of the PDF Extractor application.</p>\n<h2 id=\"privacy-and-data-collection\">Privacy and Data Collection</h2>\n<p><strong>No Data Collection</strong>: PDF Extractor does not collect, store, transmit, or process any personal data or user information. The application operates entirely on your local device without any network connections for data collection purposes.</p>\n<p><strong>Local Processing Only</strong>: All PDF processing and content extraction happens locally on your Mac. Your files and extracted content never leave your device.</p>\n<p><strong>No Analytics</strong>: We do not use any analytics, tracking, or monitoring services in PDF Extractor.</p>\n<p><strong>No Third-Party Services</strong>: PDF Extractor does not integrate with any third-party services that could collect or process your data.</p>\n<h2 id=\"license-and-usage\">License and Usage</h2>\n<p><strong>Personal Use</strong>: PDF Extractor is licensed for personal use on macOS devices you own or control.</p>\n<p><strong>Commercial Use</strong>: Commercial use of PDF Extractor requires appropriate licensing as specified in the Mac App Store.</p>\n<p>** Redistribution**: You may not redistribute, sell, or sublicense PDF Extractor without explicit permission.</p>\n<h2 id=\"intellectual-property\">Intellectual Property</h2>\n<p>PDF Extractor and all its components are owned by Muhammet Ali Petek and are protected by copyright laws and international treaty provisions.</p>\n<h2 id=\"disclaimer-of-warranty\">Disclaimer of Warranty</h2>\n<p>PDF Extractor is provided “AS IS” without warranty of any kind, either express or implied, including but not limited to the implied warranties of merchantability and fitness for a particular purpose.</p>\n<h2 id=\"limitation-of-liability\">Limitation of Liability</h2>\n<p>In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.</p>\n<h2 id=\"app-store-terms\">App Store Terms</h2>\n<p>If you obtained PDF Extractor through the Mac App Store, these Terms are in addition to the Apple Media Services Terms and Conditions, which govern your use of the Mac App Store and PDF Extractor.</p>\n<h2 id=\"changes-to-terms\">Changes to Terms</h2>\n<p>We reserve the right to update these Terms of Service from time to time. Any changes will be effective when a new version of the application is released.</p>\n<h2 id=\"contact\">Contact</h2>\n<p>If you have questions about these Terms of Service, please contact us through the Mac App Store support channels.</p>\n<h2 id=\"governing-law\">Governing Law</h2>\n<p>These Terms of Service shall be governed by and construed in accordance with the laws of Turkey.</p>";

				const frontmatter = {"layout":"../../layouts/Legal.astro","title":"PDF Extractor — Terms of Service"};
				const file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/pdfextractor/terms-of-service.md";
				const url = "/pdfextractor/terms-of-service";
				function rawContent() {
					return "   \n                                 \n                                         \n   \n\n# PDF Extractor Terms of Service\n\n**Effective Date**: January 3, 2026\n\n## Introduction\n\nWelcome to PDF Extractor, a macOS application designed to extract images and content from PDF files. These Terms of Service govern your use of the PDF Extractor application.\n\n## Privacy and Data Collection\n\n**No Data Collection**: PDF Extractor does not collect, store, transmit, or process any personal data or user information. The application operates entirely on your local device without any network connections for data collection purposes.\n\n**Local Processing Only**: All PDF processing and content extraction happens locally on your Mac. Your files and extracted content never leave your device.\n\n**No Analytics**: We do not use any analytics, tracking, or monitoring services in PDF Extractor.\n\n**No Third-Party Services**: PDF Extractor does not integrate with any third-party services that could collect or process your data.\n\n## License and Usage\n\n**Personal Use**: PDF Extractor is licensed for personal use on macOS devices you own or control.\n\n**Commercial Use**: Commercial use of PDF Extractor requires appropriate licensing as specified in the Mac App Store.\n\n** Redistribution**: You may not redistribute, sell, or sublicense PDF Extractor without explicit permission.\n\n## Intellectual Property\n\nPDF Extractor and all its components are owned by Muhammet Ali Petek and are protected by copyright laws and international treaty provisions.\n\n## Disclaimer of Warranty\n\nPDF Extractor is provided \"AS IS\" without warranty of any kind, either express or implied, including but not limited to the implied warranties of merchantability and fitness for a particular purpose.\n\n## Limitation of Liability\n\nIn no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.\n\n## App Store Terms\n\nIf you obtained PDF Extractor through the Mac App Store, these Terms are in addition to the Apple Media Services Terms and Conditions, which govern your use of the Mac App Store and PDF Extractor.\n\n## Changes to Terms\n\nWe reserve the right to update these Terms of Service from time to time. Any changes will be effective when a new version of the application is released.\n\n## Contact\n\nIf you have questions about these Terms of Service, please contact us through the Mac App Store support channels.\n\n## Governing Law\n\nThese Terms of Service shall be governed by and construed in accordance with the laws of Turkey.";
				}
				async function compiledContent() {
					return await html();
				}
				function getHeadings() {
					return [{"depth":1,"slug":"pdf-extractor-terms-of-service","text":"PDF Extractor Terms of Service"},{"depth":2,"slug":"introduction","text":"Introduction"},{"depth":2,"slug":"privacy-and-data-collection","text":"Privacy and Data Collection"},{"depth":2,"slug":"license-and-usage","text":"License and Usage"},{"depth":2,"slug":"intellectual-property","text":"Intellectual Property"},{"depth":2,"slug":"disclaimer-of-warranty","text":"Disclaimer of Warranty"},{"depth":2,"slug":"limitation-of-liability","text":"Limitation of Liability"},{"depth":2,"slug":"app-store-terms","text":"App Store Terms"},{"depth":2,"slug":"changes-to-terms","text":"Changes to Terms"},{"depth":2,"slug":"contact","text":"Contact"},{"depth":2,"slug":"governing-law","text":"Governing Law"}];
				}

				const Content = createComponent((result, _props, slots) => {
					const { layout, ...content } = frontmatter;
					content.file = file;
					content.url = url;

					return renderTemplate`${renderComponent(result, 'Layout', $$Legal, {
								file,
								url,
								content,
								frontmatter: content,
								headings: getHeadings(),
								rawContent,
								compiledContent,
								'server:root': true,
							}, {
								'default': () => renderTemplate`${unescapeHTML(html())}`
							})}`;
				});

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
	__proto__: null,
	Content,
	compiledContent,
	default: Content,
	file,
	frontmatter,
	getHeadings,
	rawContent,
	url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
