import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import electrumServers from 'agama-wallet-lib/build/electrum-servers';
import { Meteor } from 'meteor/meteor';
import actions from './actions/actions';
import {
  setLocalStorageVar,
  getLocalStorageVar,
  convertURIToImageData,
  assetsPath,
  sortObject,
  removeDisabledSPVCoins,
} from './actions/utils';
import translate from './translate/translate';
import {
  devlog,
  config,
} from './actions/dev';
import {
  getRandomIntInclusive,
  sort,
} from 'agama-wallet-lib/build/utils';
import supportedCoinsList from './actions/coins';

import SendCoin from './components/SendCoin';
import AddCoin from './components/AddCoin';
import Login from './components/Login';
import Transactions from './components/Transactions/Transactions';
import ServerSelect from './components/ServerSelect';
import CreateSeed from './components/CreateSeed';
import KMDInterest from './components/KMDInterest';
import OfflineSigning from './components/OfflineSigning';
import Pin from './components/Pin';
import Recovery from './components/Recovery';
import Overview from './components/Overview';
import Settings from './components/Settings/Settings';
import Exchanges from './components/Exchanges/Exchanges';
import settingsDefaults from './components/Settings/settingsDefaults';

const DASHBOARD_UPDATE_INTERVAL = 120000; // 2m
const PROXY_RETRY_COUNT = 2;
const PROXY_RETRY_TIMEOUT = 5000;
const PRICES_UPDATE_INTERVAL = 300000; // 5m

let _settings = getLocalStorageVar('settings');

if (!_settings) {
  setLocalStorageVar('settings', settingsDefaults);
} else {
  for (let key in settingsDefaults) {
    if (!_settings[key]) {
      _settings[key] = settingsDefaults[key];
      setLocalStorageVar('settings', _settings);
    }
  }
}

class App extends React.Component {
  constructor() {
    super();
    this.state = {
      address: null,
      balance: null,
      transactions: null,
      utxo: null,
      errors: null,
      displayMenu: false,
      loading: false,
      coin: null,
      coins: {},
      pubKeys: {},
      activeSection: 'login',
      saveSeed: null,
      auth: false,
      updateInterval: null,
      conError: false,
      proxyError: false,
      proxyErrorCount: 0,
      proxyRetryInProgress: false,
      overview: null,
      history: null,
      btcFees: null,
      ethGasPrice: null,
      prices: null,
      title: null,
    };
    this.globalClickTimeout = null;
    this.overviewInterval = null;
    this.pricesUpdateInterval = null;
    this.defaultState = JSON.parse(JSON.stringify(this.state));
    this.login = this.login.bind(this);
    this.logout = this.logout.bind(this);
    this.lock = this.lock.bind(this);
    this.getBalance = this.getBalance.bind(this);
    this.getTransactions = this.getTransactions.bind(this);
    this.toggleMenu = this.toggleMenu.bind(this);
    this.dashboardRefresh = this.dashboardRefresh.bind(this);
    this.switchCoin = this.switchCoin.bind(this);
    this.addCoin = this.addCoin.bind(this);
    this.changeActiveSection = this.changeActiveSection.bind(this);
    this.toggleAutoRefresh = this.toggleAutoRefresh.bind(this);
    this.toggleKMDInterest = this.toggleKMDInterest.bind(this);
    this.toggleOverview = this.toggleOverview.bind(this);
    this.toggleMenuOption = this.toggleMenuOption.bind(this);
    this.globalClick = this.globalClick.bind(this);
    this.historyBack = this.historyBack.bind(this);
    this.scrollToTop = this.scrollToTop.bind(this);
    this.getBtcFees = this.getBtcFees.bind(this);
    this.getEthGasPrice = this.getEthGasPrice.bind(this);
    this.retryProxy = this.retryProxy.bind(this);
    this.updateDefaultCoinServer = this.updateDefaultCoinServer.bind(this);
    this.toggleExchanges = this.toggleExchanges.bind(this);
    this.updateCoinsList = this.updateCoinsList.bind(this);
    this.updatePrices = this.updatePrices.bind(this);
    this.changeTitle = this.changeTitle.bind(this)
  }

  changeTitle(title) { // too dirty :(
    this.setState({
      title,
    });
  }

  componentWillMount() {
    const { actions } = this.props;
    let _localStorageCoins = getLocalStorageVar('coins');

    if (_localStorageCoins) {      
      // remove coins that are no longer supported/temp disabled
      removeDisabledSPVCoins(_localStorageCoins);
      setLocalStorageVar('coins', _localStorageCoins);

      // convert coins obj to 0.1.4, applicable to any version below 0.1.4
      // remove coins that are no longer supported
      for (let key in _localStorageCoins) {
        let _diffFound = false;

        if (key.indexOf('|spv') === -1 &&
            key.indexOf('|eth') === -1) {
          _localStorageCoins[`${key}|spv`] = _localStorageCoins[key];
          delete _localStorageCoins[key];
          _diffFound = true;
        } else if (
          (key.indexOf('|spv') > -1 && supportedCoinsList.spv.indexOf(key.split('|')[0].toUpperCase()) === -1) ||
          (key.indexOf('|eth') > -1 && supportedCoinsList.eth.indexOf(key.split('|')[0].toUpperCase()) === -1)) {
          delete _localStorageCoins[key];
          _diffFound = true;
        }

        if (_diffFound) {
          setLocalStorageVar('coins', _localStorageCoins);
        }       
      }
      
      this.setState({
        coins: _localStorageCoins,
      });
    }
  }

  updatePrices() {
    const { actions } = this.props;
    const coins = Object.keys(getLocalStorageVar('coins'));
    let coinsPrices = [];

    for (let i = 0; i < coins.length; i++) {
      coinsPrices.push(coins[i].split('|')[0]);
    }

    actions.getPrices(coinsPrices)
    .then((res) => {
      this.setState({
        prices: res,
      });
    });
  }

  updateCoinsList() {
    const { actions } = this.props;
    let localStorageCoins = getLocalStorageVar('coins');
    const localStorageCoinsKeys = Object.keys(localStorageCoins);

    actions.getOverview(localStorageCoins)
    .then((res) => {
      this.setState({
        overview: res,
      });
    });

    if (localStorageCoinsKeys.length) {
      this.setState({
        coins: localStorageCoins,
      });

      if (localStorageCoinsKeys.indexOf(this.state.coin) === -1) {
        if (localStorageCoinsKeys.indexOf('kmd|spv') > -1) {
          this.switchCoin('kmd|spv');
        } else {
          this.switchCoin(localStorageCoinsKeys[0]);
        }
      }
    } else {
      this.setState({
        coins: {},
        address: null,
        balance: null,
        transactions: null,
        utxo: null,
        coin: null,
        activeSection: 'addcoin',
        history: null,  
      });
    }
  }

  updateDefaultCoinServer(coin, server) {
    let _newState = JSON.parse(JSON.stringify(this.state.coins));
    _newState[coin].server = server;
    
    setLocalStorageVar('coins', _newState);
    this.setState({
      coins: _newState,
    });
  }

  retryProxy(disableAnimation) {
    const { actions } = this.props;

    if (!disableAnimation ||
        typeof disableAnimation === 'object') {
      this.setState({
        proxyRetryInProgress: true,
      });

      Meteor.setTimeout(() => {
        this.setState({
          proxyRetryInProgress: false,
        });
      }, 1000);
    }
    
    actions.getAnotherProxy();
    this.dashboardRefresh();
  }

  getBtcFees() {
    const { actions } = this.props;
  
    this.setState({
      btcFees: null,
    });

    actions.getBtcFees()
    .then((res) => {
      this.setState({
        btcFees: res,
      });

      if (res === 'error') {
        Meteor.setTimeout(() => {
          this.getBtcFees();
        }, 5000);
      }
    });
  }

  getEthGasPrice() {
    const { actions } = this.props;
  
    this.setState({
      ethGasPrice: null,
    });

    actions.getEthGasPrice()
    .then((res) => {
      this.setState({
        ethGasPrice: res,
      });

      if (res === 'error') {
        Meteor.setTimeout(() => {
          this.getEthGasPrice();
        }, 5000);
      }
    });
  }

  historyBack() {
    this.setState({
      activeSection: this.state.history,
      history: null,
    });
    
    this.scrollToTop();
  }

  scrollToTop() {
    window.scrollTo(0, 0);
  }

  globalClick() {
    const _storageSettings = getLocalStorageVar('settings');    
    const DEFAULT_LOCK_INACTIVE_INTERVAL = _storageSettings && _storageSettings.autoLockTimeout ? _storageSettings.autoLockTimeout : 600000; // 10m
    
    if (this.state.auth) {
      if (this.globalClickTimeout) {
        Meteor.clearTimeout(this.globalClickTimeout);
      }

      if (!config.dev ||
          (config.dev && config.preload && !config.preload.disableAutoLock) ||
          (config.dev && !config.preload)) {
        this.globalClickTimeout = Meteor.setTimeout(() => {
          devlog(`logout after ${DEFAULT_LOCK_INACTIVE_INTERVAL}ms inactivity`);
          this.lock();
        }, DEFAULT_LOCK_INACTIVE_INTERVAL);
      }

      devlog('global click', 'set timer');
    }
  }

  addCoin(coin, skipRefresh) {
    let coins = this.state.coins;

    if (coin.indexOf('|spv') > -1) {
      const _coin = coin.split('|')[0];
      let server = electrumServers[_coin];

      // pick a random server to communicate with
      if (server.serverList &&
          server.serverList.length > 0) {
        const randomServerId = getRandomIntInclusive(0, server.serverList.length - 1);
        const randomServer = server.serverList[randomServerId];
        const serverDetails = randomServer.split(':');

        if (serverDetails.length === 3) {
          server = {
            ip: serverDetails[0],
            port: serverDetails[1],
            proto: serverDetails[2],
          };
        }
      }

      coins[coin] = {
        server,
      };
    } else {
      coins[coin] = {};
    }

    setLocalStorageVar('coins', this.state.coins);

    if (!this.state.auth) {
      this.setState({
        coins,
        history: null,
        activeSection: 'login',
      });
    } else {
      const { actions } = this.props;

      actions.addKeyPair(coin)
      .then((res) => {
        let _pubKeys = JSON.parse(JSON.stringify(this.state.pubKeys));
        const _coin = coin.split('|');

        _pubKeys[_coin[1]][_coin[0]] = res;

        this.setState({
          coins,
          history: null,
          activeSection: skipRefresh ? this.state.activeSection : 'dashboard',
          coin,
          address: res,
          loading: true,
          transactions: this.state.coins[coin] ? this.state.coins[coin].transactions: null,
          balance: this.state.coins[coin] ? this.state.coins[coin].balance: null,
          pubKeys: _pubKeys,
        });

        if (!skipRefresh) this.scrollToTop();
        this.dashboardRefresh();
      });
    }
  }

  toggleKMDInterest() {
    const { actions } = this.props;

    this.setState({
      utxo: null,
      history: this.state.activeSection,
      activeSection: 'claim',
    });

    actions.kmdUnspents()
    .then((res) => {
      this.scrollToTop();
      this.setState({
        utxo: res,
      });
    });
  }

  changeActiveSection(section, toggleMenu) {
    if (toggleMenu) {
      this.setState({
        displayMenu: false,
        history: this.state.activeSection,
        activeSection: section,
        title: null,
      });
    } else {
      this.setState({
        history: this.state.activeSection,        
        activeSection: section,
        title: null,
      });
    }

    if (this.state.coin &&
        this.state.coin === 'btc|spv' &&
        section === 'send') {
      this.getBtcFees();
    }

    if (this.state.coin &&
        this.state.coin.indexOf('|eth') > -1 &&
        section === 'send') {
      this.getEthGasPrice();
    }

    this.scrollToTop();
  }

  switchCoin(coin, skipRefresh) {
    const _name = coin.split('|')[0];
    const _mode = coin.split('|')[1];

    this.setState({
      coin: coin,
      address: this.state.pubKeys[_mode][_name],
      history: this.state.activeSection,
      activeSection: skipRefresh ? this.state.activeSection : 'dashboard',
      transactions: this.state.coins[coin] ? this.state.coins[coin].transactions: null,
      balance: this.state.coins[coin] ? this.state.coins[coin].balance: null,
    });

    // toggle refresh and update in-mem coins cache obj
    if (!skipRefresh) {
      Meteor.setTimeout(() => {
        this.toggleMenu();
        this.dashboardRefresh();
        this.scrollToTop();
      }, 10);
    } else {
      Meteor.setTimeout(() => {
        this.dashboardRefresh();
      }, 10);
    }
  }

  toggleAutoRefresh(disable) {
    if (disable) {
      Meteor.clearInterval(this.state.updateInterval);
      Meteor.clearInterval(this.overviewInterval);
      Meteor.clearInterval(this.pricesUpdateInterval);

      this.setState({
        updateInterval: null,
      });
      this.overviewInterval = null;
      this.pricesUpdateInterval = null;
    } else {
      const _updateInterval = Meteor.setInterval(() => {
        if (this.state.activeSection === 'dashboard') {
          this.dashboardRefresh();
        }
      }, DASHBOARD_UPDATE_INTERVAL);

      this.setState({
        updateInterval: _updateInterval,
      });
    }
  }

  dashboardRefresh() {
    this.getBalance();
    this.getTransactions();
  }

  getBalance() {
    const { actions } = this.props;

    actions.balance(this.state.coin)
    .then((res) => {
      if (res &&
          res === 'proxy-error') {
        let _newState = {
          proxyError: true,
          proxyErrorCount: this.state.proxyErrorCount + 1,
        };

        if (this.state.proxyErrorCount + 1 <= PROXY_RETRY_COUNT &&
            this.state.proxyErrorCount >= 0) {
          Meteor.setTimeout(() => {
            devlog(`proxy retry attempt #${this.state.proxyErrorCount}`);
            this.retryProxy(true);
          }, PROXY_RETRY_TIMEOUT);
        } else {
          _newState = {
            proxyError: true,
            proxyErrorCount: -777,
          }
          devlog(`${PROXY_RETRY_COUNT} consecutive proxy retry attempts have failed, go manual`);
        }

        this.setState(_newState);
      } else {
        if (res &&
            !res.hasOwnProperty('balance') &&
            res.indexOf('error') > -1) {
          this.setState({
            balance: null,
            transactions: null,
            conError: true,
          });
        } else {
          this.setState({
            balance: res,
            conError: false,
            proxyError: false,
            proxyErrorCount: 0,
          });
        }
      }
    });
  }

  getTransactions() {
    const { actions } = this.props;

    this.setState({
      loading: true,
    });

    actions.transactions(this.state.coin)
    .then((res) => {
      if (res &&
          (res.indexOf('error') > -1 || res.indexOf('proxy-error') > -1)) {
        this.setState({
          balance: null,
          transactions: null,
          loading: false,
          conError: true,
        });
      } else {
        res = sort(res, 'timestamp', true);

        this.setState({
          transactions: res,
          loading: false,
          conError: false,
          proxyError: false,
          proxyErrorCount: 0,          
        });
      }
    });
  }

  // purge keys and added coins
  logout() {
    const { actions } = this.props;

    actions.clearKeys()
    .then((res) => {
      this.toggleAutoRefresh(true);
      setLocalStorageVar('coins', {});

      Meteor.setTimeout(() => {
        this.toggleMenu();
      }, 10);
      Meteor.setTimeout(() => {
        this.setState(this.defaultState);
      }, 20);
      this.scrollToTop();
    });
  }

  // lock is logout when list of added coins is persistent
  lock(purgeSeed) {
    const { actions } = this.props;

    if (typeof purgeSeed === 'boolean' &&
        purgeSeed === true) {
      setLocalStorageVar('seed', null);
    }

    if (this.globalClickTimeout) {
      Meteor.clearTimeout(this.globalClickTimeout);
    }

    actions.clearKeys()
    .then((res) => {
      let lockState = Object.assign({}, this.defaultState);
      lockState.coins = this.state.coins;

      this.toggleAutoRefresh(true);
      Meteor.setTimeout(() => {
        this.setState(lockState);
      }, 20);
      this.scrollToTop();
    });
  }

  login(passphrase) {
    const { actions } = this.props;
    let overviewCoinsInit = [];

    for (let key in this.state.coins) {
      overviewCoinsInit.push({
        balanceFiat: 'loading',
        balanceNative: 'loading',
        coin: key,
        fiatPricePerItem: 'loading',
      });
    }

    this.setState({
      overview: overviewCoinsInit,
    });

    const _login = () => {
      actions.auth(passphrase, this.state.coins)
      .then((res) => {
        this.updatePrices();
        this.pricesUpdateInterval = Meteor.setInterval(() => {
          this.updatePrices();
        }, PRICES_UPDATE_INTERVAL);

        actions.getOverview(this.state.coins)
        .then((res) => {
          this.setState({
            overview: res,
          });
        });

        // select a coin and an address
        let coin;
        let address;
  
        if (this.state.coins['kmd|spv']) {
          coin = 'kmd|spv';
          address = res.spv.kmd;
        } else {
          const _name = Object.keys(this.state.coins)[0].split('|')[0];
          coin = Object.keys(this.state.coins)[0];
          address = res.spv[_name] || res.eth[_name];
        }
  
        if (config.preload &&
            config.preload.activeCoin) {
          coin = config.preload.activeCoin;
          address = res.spv[coin.split('|')[0]] || res.eth[coin.split('|')[0]];
        }
  
        this.setState({
          auth: true,
          pubKeys: res,
          coin,
          address,
          history: null,
          activeSection: 'dashboard',
        });
  
        this.dashboardRefresh();
        this.toggleAutoRefresh();
        this.globalClick();
        this.scrollToTop();
      });
    };

    if (!Object.keys(this.state.coins).length) {
      this.addCoin('kmd|spv');
      
      Meteor.setTimeout(() => {
        _login();
      }, 10); 
    } else {
      _login();
    }
  }

  toggleMenu() {
    this.setState({
      displayMenu: !this.state.displayMenu,
    });
  }

  toggleExchanges() {
    const { actions } = this.props;

    this.toggleMenuOption('exchanges');
  }

  toggleOverview() {
    const { actions } = this.props;
    
    actions.getOverview(this.state.coins)
    .then((res) => {
      this.setState({
        overview: res,
      });
    });

    if (!this.overviewInterval) {
      const _updateInterval = Meteor.setInterval(() => {
        if (this.state.activeSection === 'overview') {
          actions.getOverview(this.state.coins)
          .then((res) => {
            this.setState({
              overview: res,
            });
          });
        }
      }, DASHBOARD_UPDATE_INTERVAL);

      this.overviewInterval = _updateInterval;
    }

    this.toggleMenuOption('overview');
  }

  toggleMenuOption(optionName) {
    Meteor.setTimeout(() => {
      this.toggleMenu();
    }, 10);

    this.setState({
      history: this.state.activeSection,
      activeSection: this.state.activeSection === optionName ? (this.state.auth ? 'dashboard' : 'login') : optionName,
    });
    this.scrollToTop();
  }

  renderActiveCoins() {
    let _coins = JSON.parse(JSON.stringify(this.state.coins));
    let _items = [];
    _coins = sortObject(_coins);

    for (let key in _coins) {
      const _name = key.split('|')[0];
      const _mode = key.split('|')[1];
      
      _items.push(
        <div
          onClick={ () => key !== this.state.coin ? this.switchCoin(key) : null }
          key={ `active-coins-${key}` }
          className="active-coins">
          <img src={ `${assetsPath.coinLogo}/${_mode}/${_name}.png` } /> <span>{ _name.toUpperCase() }</span>
          { key === this.state.coin &&
            <i className="fa fa-check"></i>
          }
        </div>
      );
    }

    return _items;
  }

  renderMenu() {
    if (this.state.displayMenu) {
      return (
        <div className="menu-ui">
          <div className="sidemenu">
            <div className="sidemenu-inner">
              <div className="group">
                <img
                  className="rectangle9copy3"
                  src={ `${assetsPath.menu}/sidemenu-rectangle-9-copy-3.png` } />
                <img
                  className="rectangle9copy2"
                  src={ `${assetsPath.menu}/sidemenu-rectangle-9-copy-2.png` } />
                <img
                  className="rectangle9copy"
                  src={ `${assetsPath.menu}/sidemenu-rectangle-9-copy.png` } />
              </div>
              { this.state.auth &&
                <div className="items">
                  <div
                    className="item"
                    disabled={ this.state.activeSection === 'exchanges' }>
                    <div
                      className="title"
                      onClick={ this.toggleExchanges }>
                      { translate('APP_TITLE.EXCHANGES') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  <div
                    className="item"
                    disabled={ this.state.activeSection === 'overview' }>
                    <div
                      className="title"
                      onClick={ this.toggleOverview }>
                      { translate('APP_TITLE.OVERVIEW') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  <div
                    className="item"
                    disabled={ this.state.activeSection === 'dashboard' }>
                    <div
                      className="title"
                      onClick={ () => this.changeActiveSection('dashboard', true) }>
                      { translate('DASHBOARD.DASHBOARD') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  { getLocalStorageVar('seed') &&
                    <div
                      className="item"
                      disabled={ this.state.activeSection === 'recovery' }>
                      <div
                        className="title"
                        onClick={ () => this.toggleMenuOption('recovery') }>
                        { translate('APP_TITLE.RECOVERY') }
                      </div>
                      <img
                        className="line"
                        src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                    </div>
                  }
                  <div
                    className="item"
                    disabled={ this.state.activeSection === 'settings' }>
                    <div
                      className="title"
                      onClick={ () => this.toggleMenuOption('settings') }>
                      { translate('APP_TITLE.SETTINGS') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  <div className="item hide">
                    <div
                      className="title"
                      onClick={ this.logout }>
                      { translate('DASHBOARD.LOGOUT') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  <div className="item">
                    <div
                      className="title"
                      onClick={ this.lock }>
                      { translate('DASHBOARD.LOGOUT') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  { Object.keys(this.state.coins).length !== Object.keys(electrumServers).length &&
                    <div
                      className="item"
                      disabled={ this.state.activeSection === 'addcoin' }>
                      <div
                        className="title"
                        onClick={ () => this.toggleMenuOption('addcoin') }>
                        { translate('DASHBOARD.ADD_COIN') }
                      </div>
                      <img
                        className="line"
                        src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                    </div>
                  }
                  <div>
                  { this.renderActiveCoins() }
                  </div>
                </div>
              }
              { !this.state.auth &&
                <div className="items">
                  { (this.state.activeSection === 'addcoin' || this.state.activeSection === 'create-seed') &&
                    <div className="item">
                      <div
                        className="title"
                        onClick={ () => this.toggleMenuOption('login') }>
                        { translate('DASHBOARD.LOGIN') }
                      </div>
                      <img
                        className="line"
                        src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                    </div>
                  }
                  <div
                    className="item"
                    disabled={ this.state.activeSection === 'addcoin' }>
                    <div
                      className="title"
                      onClick={ () => this.toggleMenuOption('addcoin') }>
                      { translate('DASHBOARD.ADD_COIN') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  <div
                    className="item"
                    disabled={ this.state.activeSection === 'create-seed' }>
                    <div
                      className="title"
                      onClick={ () => this.toggleMenuOption('create-seed') }>
                      { translate('DASHBOARD.CREATE_SEED') }
                    </div>
                    <img
                      className="line"
                      src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                  </div>
                  { getLocalStorageVar('seed') &&
                    <div
                      className="item"
                      disabled={ this.state.activeSection === 'pin' }>
                      <div
                        className="title"
                        onClick={ () => this.toggleMenuOption('pin') }>
                        { translate('APP_TITLE.PIN') }
                      </div>
                      <img
                        className="line"
                        src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                    </div>
                  }
                  { /*this.state.activeSection !== 'offlinesig' &&
                    <div className="item">
                      <div
                        className="title"
                        onClick={ () => this.toggleMenuOption('offline-sig') }>Offline Signing</div>
                      <img
                        className="line"
                        src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                    </div>*/
                  }
                  { (this.state.activeSection === 'offlinesig' || this.state.activeSection === 'pin') &&
                    <div className="item">
                      <div
                        className="title"
                        onClick={ () => this.toggleMenuOption('login') }>
                        { translate('APP_TITLE.LOGIN') }
                      </div>
                      <img
                        className="line"
                        src={ `${assetsPath.menu}/sidemenu-rectangle-3.png` } />
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      );
    } else {
      return null;
    }
  }

  render() {
    return (
      <div
        className={ 'app-container' + (config.dev ? '' : ' unselectable') }
        onClick={ this.globalClick }>
        <div className="app-header">
          { this.state.history &&
            !this.state.displayMenu &&
            ((this.state.auth && this.state.history !== 'login' && this.state.history !== 'create-seed') || !this.state.auth) &&
            this.state.history !== this.state.activeSection &&
            (!this.state.proxyError || (this.state.proxyError && this.state.proxyErrorCount !== -777)) &&
            <img
              onClick={ this.historyBack }
              className="menu-back"
              src={ `${assetsPath.menu}/trends-combined-shape.png` } />
          }
          { (!this.state.proxyError || (this.state.proxyError && this.state.proxyErrorCount !== -777)) &&
            <img
              onClick={ this.toggleMenu }
              className="menu-icon"
              src={ `${assetsPath.home}/home-combined-shape.png` } />
          }
          <div className="ui-title">
            { translate('APP_TITLE.' + (this.state.displayMenu ? 'MENU' : this.state.title && this.state.title.toUpperCase() || this.state.activeSection.toUpperCase())) }
          </div>
        </div>
        { this.state.displayMenu &&
          (!this.state.proxyError || (this.state.proxyError && this.state.proxyErrorCount !== -777)) &&
          <div className="app-main">
            { this.renderMenu() }
          </div>
        }
        { this.state.proxyError &&
          this.state.proxyErrorCount === -777 &&
          <div className="app-main">
            <div className="con-error width-limit">
              <i className="fa fa-warning error"></i> <span className="error">{ translate('DASHBOARD.PROXY_ERROR') }</span>
            </div>
            <div className="form proxy">
              <div
                onClick={ this.retryProxy }
                disabled={
                  this.state.proxyRetryInProgress &&
                  this.state.proxyErrorCount !== -777
                }
                className={ 'group3' + (this.state.proxyRetryInProgress ? ' retrying' : '') }>
                <div className="btn-inner">
                  <div className="btn">{ translate('DASHBOARD.RETRY') }</div>
                  <div className="group2">
                    <i className="fa fa-refresh"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }
        { (this.state.activeSection === 'server-select' || !this.state.proxyError || (this.state.proxyError && this.state.proxyErrorCount !== -777)) &&
          !this.state.displayMenu &&
          (this.state.conError || this.state.activeSection === 'server-select') &&
          this.state.activeSection !== 'overview' &&
          this.state.activeSection !== 'settings' &&
          this.state.activeSection !== 'recovery' &&
          this.state.activeSection !== 'addcoin' &&
          <ServerSelect
            { ...this.state }
            dashboardRefresh={ this.dashboardRefresh }
            getServersList={ this.props.actions.getServersList }
            setDefaultServer={ this.props.actions.setDefaultServer }
            updateDefaultCoinServer={ this.updateDefaultCoinServer }
            historyBack={ this.historyBack } />
        }
        { (!this.state.proxyError || (this.state.proxyError && this.state.proxyErrorCount !== -777)) &&
          !this.state.displayMenu &&
          <div className="app-main">
            { (this.state.activeSection !== 'pin' || this.state.activeSection !== 'offlinesig') &&
              <Login
                { ...this.state }
                login={ this.login }
                lock={ this.lock } />
            }
            { this.state.activeSection === 'create-seed' &&
              <CreateSeed
                { ...this.state }
                login={ this.login }
                changeActiveSection={ this.changeActiveSection } />
            }
            { !this.state.conError &&
              <SendCoin
                { ...this.state }
                sendtx={ this.props.actions.sendtx }
                getEthGasPrice={ this.getEthGasPrice }
                sendtxEth={ this.props.actions.sendtxEth }
                changeActiveSection={ this.changeActiveSection }
                getBtcFees={ this.getBtcFees }
                lock={ this.lock } />
            }
            { this.state.activeSection !== 'exchanges' &&
              <AddCoin
                { ...this.state }
                addCoin={ this.addCoin }
                changeActiveSection={ this.changeActiveSection } />
            }
            { !this.state.conError &&
              <KMDInterest
                { ...this.state }
                sendtx={ this.props.actions.sendtx }
                changeActiveSection={ this.changeActiveSection }
                dashboardRefresh={ this.dashboardRefresh } />
            }
            { this.state.auth &&
              this.state.activeSection === 'dashboard' &&
              !this.state.conError &&
              <Transactions
                { ...this.state }
                dashboardRefresh={ this.dashboardRefresh }
                changeActiveSection={ this.changeActiveSection }
                toggleKMDInterest={ this.toggleKMDInterest } />
            }
            { !this.state.auth &&
              this.state.activeSection === 'offlinesig' &&
              <OfflineSigning />
            }
            { !this.state.auth &&
              this.state.activeSection === 'pin' &&
              <Pin
                changeActiveSection={ this.changeActiveSection }
                lock={ this.lock } />
            }
            { this.state.auth &&
              this.state.activeSection === 'recovery' &&
              <Recovery
                activeSection={ this.state.activeSection }
                getKeys={ this.props.actions.getKeys }
                lock={ this.lock } />
            }
            { this.state.auth &&
              this.state.activeSection === 'overview' &&
              <Overview { ...this.state } />
            }
            { this.state.activeSection === 'settings' &&
              <Settings
                coin={ this.state.coin }
                coins={ this.state.coins }
                globalClick={ this.globalClick }
                changeActiveSection={ this.changeActiveSection }
                logout={ this.logout }
                lock={ this.lock }
                updateCoinsList={ this.updateCoinsList }
                changeTitle={ this.changeTitle } />
            }
            { this.state.auth &&
              this.state.activeSection === 'exchanges' &&
              <Exchanges
                { ...this.state }
                getCoinswitchCoins={ this.props.actions.getCoinswitchCoins }
                getBalance={ this.props.actions.balance }
                getPrices={ this.props.actions.getPrices }
                getRate={ this.props.actions.getRate }
                getOrder={ this.props.actions.getOrder }
                placeOrder={ this.props.actions.placeOrder }
                historyBack={ this.historyBack }
                changeActiveSection={ this.changeActiveSection }
                syncExchangesHistory={ this.props.actions.syncExchangesHistory }
                getTransaction={ this.props.actions.transactions }
                switchCoin={ this.switchCoin }
                addCoin={ this.addCoin }
                sendtx={ this.props.actions.sendtx }
                getEthGasPrice={ this.getEthGasPrice }
                sendtxEth={ this.props.actions.sendtxEth }
                getBtcFees={ this.getBtcFees }
                pubKeys={ this.state.pubKeys }
                lock={ this.lock } />
            }
          </div>
        }
      </div>
    )
  }
}

mapStateToProps = (state) => {
  return {
    keys: state.keys,
  }
}

mapDispatchToProps = (dispatch) => {
  return {
    actions: bindActionCreators(actions, dispatch),
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(App);